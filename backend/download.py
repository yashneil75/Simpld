"""Download and discover the supported GGUF files."""

from __future__ import annotations

import asyncio
import threading
from enum import StrEnum
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import requests

from backend import config


class Phase(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    DONE = "done"
    ERROR = "error"


_ACTIVE = {Phase.QUEUED, Phase.DOWNLOADING, Phase.CANCELLING}
_changed = threading.Condition()
_progress: dict[str, dict] = {}


def spec_for(name: str) -> dict:
    if name not in config.MODELS:
        raise ValueError(f"Unknown model {name!r}. Available: {', '.join(config.MODELS)}")
    return config.MODELS[name]


def local_path(name: str) -> Path:
    return config.MODEL_DIR / name / spec_for(name)["file"]


def find_local(name: str) -> Path | None:
    if name not in config.MODELS:
        return None
    canonical = local_path(name)
    if canonical.is_file():
        return canonical
    for path in config.MODEL_DIR.rglob(canonical.name):
        if ".cache" not in path.relative_to(config.MODEL_DIR).parts and path.is_file():
            return path
    return None


def is_downloaded(name: str) -> bool:
    return find_local(name) is not None


def library() -> list[dict]:
    entries = []
    for name, spec in config.MODELS.items():
        path = find_local(name)
        try:
            size = path.stat().st_size if path is not None else None
        except FileNotFoundError:
            path, size = None, None
        entries.append({
            "id": name,
            "label": spec["label"],
            "remote_bytes": int(spec["size_gb"] * 1e9),
            "description": spec["description"],
            "downloaded": path is not None,
            "size_bytes": size,
            "path": str(path) if path is not None else None,
            "ctx": spec["ctx"],
            "min_vram_gb": spec["min_vram_gb"],
            "min_ram_gb": spec["min_ram_gb"],
            "arch": spec["arch"],
            "quant": spec["quant"],
            "repo": spec["repo"],
        })
    return entries


def delete(name: str) -> bool:
    with _changed:
        path = find_local(name)
        if path is None:
            return False
        path.unlink()
        _progress.pop(name, None)
        return True


def download_progress() -> dict[str, dict]:
    with _changed:
        return {name: dict(entry) for name, entry in _progress.items()}


def _start_locked(name: str) -> dict:
    spec_for(name)
    entry = _progress.get(name)
    if entry and entry["status"] in _ACTIVE:
        return entry
    path = find_local(name)
    size = path.stat().st_size if path else 0
    entry = _progress[name] = {
        "downloaded": size, "total": size or None,
        "status": Phase.DONE if path else Phase.QUEUED, "error": None,
    }
    if not path:
        try:
            threading.Thread(target=_worker, args=(name, entry), daemon=True).start()
        except RuntimeError as exc:
            entry.update(status=Phase.ERROR, error=str(exc))
    return entry


def start_download(name: str) -> dict:
    with _changed:
        return dict(_start_locked(name))


def cancel_download(name: str) -> None:
    spec_for(name)
    with _changed:
        entry = _progress.get(name)
        if entry and entry["status"] in {Phase.QUEUED, Phase.DOWNLOADING}:
            entry["status"] = Phase.CANCELLING


class _Cancelled(Exception):
    pass


def _check_cancelled(entry: dict) -> None:
    if entry["status"] == Phase.CANCELLING:
        raise _Cancelled


def _worker(name: str, entry: dict) -> None:
    dest = local_path(name)
    tmp = dest.with_suffix(f".{uuid4().hex}.gguf.part")
    try:
        with _changed:
            _check_cancelled(entry)
            entry["status"] = Phase.DOWNLOADING
        dest.parent.mkdir(parents=True, exist_ok=True)
        spec = spec_for(name)
        url = f"https://huggingface.co/{quote(spec['repo'])}/resolve/main/{quote(spec['file'])}"
        with requests.get(
            url,
            headers={"Accept-Encoding": "identity"}, stream=True, timeout=30,
        ) as response:
            response.raise_for_status()
            length = response.headers.get("Content-Length")
            total = int(length) if length else None
            with _changed:
                _check_cancelled(entry)
                entry["total"] = total
            done = 0
            with tmp.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    with _changed:
                        _check_cancelled(entry)
                    output.write(chunk)
                    done += len(chunk)
                    with _changed:
                        entry["downloaded"] = done
        if not done or (total is not None and done != total):
            raise RuntimeError("The download ended before the complete file arrived.")
        with tmp.open("rb") as downloaded:
            if downloaded.read(4) != b"GGUF":
                raise RuntimeError("The server did not return a GGUF file.")
        with _changed:
            _check_cancelled(entry)
            if dest.is_file():
                tmp.unlink()
            else:
                tmp.replace(dest)
            entry.update(status=Phase.DONE, total=done)
            _changed.notify_all()
    except Exception as exc:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        with _changed:
            if entry["status"] == Phase.CANCELLING:
                entry["status"] = Phase.CANCELLED
            else:
                entry.update(status=Phase.ERROR, error=str(exc))
            _changed.notify_all()


def _completed_path(name: str, entry: dict) -> Path:
    if entry["status"] != Phase.DONE:
        raise RuntimeError(entry["error"] or "Download cancelled")
    path = find_local(name)
    if path is None:
        raise RuntimeError("The downloaded file was removed.")
    return path


async def download_for_runtime(name: str) -> Path:
    # Retain the exact job so a retry cannot replace the result we await.
    with _changed:
        entry = _start_locked(name)
    while True:
        with _changed:
            if entry["status"] not in _ACTIVE:
                return _completed_path(name, entry)
        await asyncio.sleep(0.25)


def download(name: str) -> Path:
    """Join the same download used by Settings if the file is missing."""
    with _changed:
        entry = _start_locked(name)
        _changed.wait_for(lambda: entry["status"] not in _ACTIVE)
        return _completed_path(name, entry)


if __name__ == "__main__":
    import sys

    for name in sys.argv[1:] or [config.DEFAULT_MODEL]:
        print(f"{name}: {download(name)}")
