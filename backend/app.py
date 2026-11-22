"""FastAPI backend for the Simpld desktop app.

Replaces ui.py's pywebview Api with HTTP + SSE so a React frontend (served by
Vite in dev, by Electron from dist/ in prod) can drive the same SQLite store
and the same llama.cpp models.

Run:  python -m backend.app            -> http://127.0.0.1:8000
       SIMPLD_PORT=8001 python -m backend.app
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import sys
import threading
from contextlib import aclosing, asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend import config, download as download_mod
from backend.model import Phase, manager
from backend.store import Store

log = logging.getLogger("simpld.backend")


@asynccontextmanager
async def lifespan(_app):
    try:
        yield
    finally:
        await manager.close()


_desktop_token = os.environ.get("SIMPLD_BACKEND_TOKEN", "")
_origins = {"http://localhost:5173", "http://127.0.0.1:5173"}
if _desktop_token:
    _origins.add("null")  # Packaged Electron renderer uses file://.


async def _authorize(request: Request):
    if request.url.path == "/api/health":
        return
    origin = request.headers.get("origin")
    if origin and origin != str(request.base_url).rstrip("/") and origin not in _origins:
        raise HTTPException(status_code=403, detail="Unrecognized request origin.")
    supplied = request.headers.get("X-Simpld-Token", "").encode()
    if _desktop_token and not secrets.compare_digest(supplied, _desktop_token.encode()):
        raise HTTPException(status_code=401, detail="Invalid desktop session.")


app = FastAPI(title="Simpld backend", lifespan=lifespan, dependencies=[Depends(_authorize)])
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_origins),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-Simpld-Token"],
)

store = Store()
_state_lock = threading.Lock()
_project = str(config.WORKSPACE)
store.ensure_project(_project)
_conversation: int | None = store.newest(_project)


@dataclass
class ChatRun:
    conversation: int | None
    messages: list[dict]
    finished: asyncio.Event = field(default_factory=asyncio.Event)


_active_chat: ChatRun | None = None
_session_revision = 0


# --- schemas ---------------------------------------------------------------

class OpenProjectBody(BaseModel):
    path: str


class DeleteProjectBody(BaseModel):
    path: str


class ChatBody(BaseModel):
    content: str
    revision: int | None = None


class SelectModelBody(BaseModel):
    name: str


class SettingBody(BaseModel):
    value: Any


# --- helpers ---------------------------------------------------------------

def _get_project() -> str:
    with _state_lock:
        return _project


def _get_conversation() -> int | None:
    with _state_lock:
        return _conversation


def _set_project(path: str) -> int | None:
    global _project, _conversation, _session_revision
    store.ensure_project(path)
    _project, _conversation = path, store.newest(path)
    _session_revision += 1
    return _conversation


def _begin_chat(body: ChatBody) -> ChatRun:
    global _conversation, _active_chat
    text = body.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty message")
    with _state_lock:
        if body.revision is not None and body.revision != _session_revision:
            raise HTTPException(status_code=409, detail="The active chat changed before the message was sent.")
        if _active_chat is not None or manager.phase == Phase.UNLOADING:
            raise HTTPException(status_code=409, detail="A response is still in progress.")
        if _conversation is None:
            _conversation = store.new_conversation(_project)
        store.append(_conversation, {"role": "user", "content": text})
        _active_chat = ChatRun(_conversation, store.load(_conversation))
        return _active_chat


def _finish_chat(run: ChatRun, reply: str) -> None:
    global _active_chat
    with _state_lock:
        try:
            if run.conversation is not None and reply:
                store.append(run.conversation, {"role": "assistant", "content": reply})
        finally:
            _active_chat = None
            run.finished.set()


def _setting(key: str, default):
    stored = store.setting(key)
    return default if stored is None else json.loads(stored)


# --- routes ----------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/system")
def system_info() -> dict:
    import subprocess

    import psutil

    ram = psutil.virtual_memory()
    gib = 1024**3
    vram_total = vram_free = None
    gpu_type = "unknown"
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
            stderr=subprocess.DEVNULL, text=True, timeout=5, creationflags=flags,
        )
        devices = []
        for line in output.splitlines():
            try:
                total, free = (float(value) / 1024 for value in line.split(","))
                devices.append((total, free))
            except ValueError:
                continue
        if devices:
            vram_total, vram_free = max(devices, key=lambda device: device[1])
            gpu_type = "discrete"
    except (OSError, subprocess.SubprocessError):
        pass
    return {
        "ram_total_gb": round(ram.total / gib, 1),
        "ram_available_gb": round(ram.available / gib, 1),
        "vram_total_gb": round(vram_total, 1) if vram_total is not None else None,
        "vram_available_gb": round(vram_free, 1) if vram_free is not None else None,
        "gpu_type": gpu_type,
    }


@app.get("/api/models")
async def get_models() -> dict:
    return manager.status()


@app.post("/api/models/select")
async def select_model(body: SelectModelBody) -> dict:
    try:
        return manager.select(body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/models/load")
async def load_model() -> dict:
    return manager.load_in_background()


@app.get("/api/models/library")
async def get_library() -> dict:
    entries = await asyncio.to_thread(download_mod.library)
    return {**manager.status(), "models": entries, "downloads": download_mod.download_progress()}


@app.post("/api/models/download")
def start_model_download(body: SelectModelBody) -> dict:

    try:
        return download_mod.start_download(body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/models/download/cancel")
def cancel_model_download(body: SelectModelBody) -> dict:
    try:
        download_mod.cancel_download(body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"cancelled": body.name}


@app.get("/api/models/download/progress")
def download_progress() -> dict:

    return {"downloads": download_mod.download_progress()}


@app.delete("/api/models/library/{model_id:path}")
async def delete_model(model_id: str) -> dict:
    if _active_chat is not None:
        raise HTTPException(status_code=409, detail="Wait for the current response before deleting the model.")
    try:
        deleted = await manager.delete_weights(model_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Model file not found")
    return {"deleted": model_id}


@app.get("/api/projects")
def get_projects() -> dict:
    project = _get_project()
    return {
        "current": project,
        "workspace": str(config.WORKSPACE),
        "projects": [
            {"path": path, "name": Path(path).name or path}
            for path in store.projects()
        ],
    }


@app.post("/api/projects/open")
def open_project(body: OpenProjectBody) -> dict:
    with _state_lock:
        conv = _set_project(body.path)
    return {"current": body.path, "conversation": conv}


@app.post("/api/projects/delete")
def delete_project(body: DeleteProjectBody) -> dict:
    if body.path == str(config.WORKSPACE):
        raise HTTPException(status_code=400, detail="The workspace folder cannot be deleted")
    with _state_lock:
        if _active_chat and _active_chat.conversation is not None:
            if store.project_of(_active_chat.conversation) == body.path:
                _active_chat.conversation = None
        store.delete_project(body.path)
        if body.path == _project:
            _set_project(str(config.WORKSPACE))
        return {"current": _project}


@app.get("/api/session")
async def get_session(settled: bool = False) -> dict:
    run = _active_chat
    if settled and run is not None:
        try:
            await asyncio.wait_for(run.finished.wait(), timeout=3)
        except TimeoutError:
            pass
    return await asyncio.to_thread(_session_snapshot)


def _session_snapshot() -> dict:
    with _state_lock:
        return {
            "revision": _session_revision,
            "currentProject": _project,
            "workspace": str(config.WORKSPACE),
            "projects": [{"path": path, "name": Path(path).name or path} for path in store.projects()],
            "currentChat": _conversation,
            "messages": store.load(_conversation) if _conversation is not None else [],
            "chats": store.summaries(),
        }


@app.get("/api/history")
def get_history() -> dict:
    with _state_lock:
        conv = _conversation
        return {"messages": store.load(conv) if conv is not None else [], "conversation": conv}


@app.get("/api/conversations")
def get_conversations() -> dict:
    return {"current": _get_conversation(), "chats": store.summaries()}


@app.post("/api/conversations/new")
def new_chat() -> dict:
    global _conversation, _session_revision
    with _state_lock:
        _conversation = None
        _session_revision += 1
    return {"conversation": None}


@app.post("/api/conversations/{conversation_id}/open")
def open_chat(conversation_id: int) -> dict:
    global _conversation, _project, _session_revision
    with _state_lock:
        project = store.project_of(conversation_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Chat not found")
        _conversation, _project = conversation_id, project
        _session_revision += 1
        return {"conversation": conversation_id, "project": project}


@app.delete("/api/conversations/{conversation_id}")
def delete_chat(conversation_id: int) -> dict:
    global _conversation, _session_revision
    with _state_lock:
        store.delete_conversation(conversation_id)
        if _active_chat and _active_chat.conversation == conversation_id:
            _active_chat.conversation = None
        if conversation_id == _conversation:
            _conversation = None
            _session_revision += 1
        return {"conversation": _conversation}


@app.get("/api/settings")
def get_settings() -> dict:
    return {"confirm_delete": _setting("confirm_delete", True)}


@app.put("/api/settings/{key}")
def put_setting(key: str, body: SettingBody) -> dict:
    store.set_setting(key, json.dumps(body.value))
    return {"key": key, "value": body.value}


@app.post("/api/chat")
async def chat(body: ChatBody) -> dict:
    run = _begin_chat(body)
    conversation = run.conversation
    parts = []
    try:
        async with aclosing(manager.tokens(run.messages)) as tokens:
            async for token in tokens:
                parts.append(token)
    except Exception as exc:
        log.exception("chat failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        _finish_chat(run, "".join(parts))
    return {"reply": "".join(parts), "conversation": conversation}


class ChatResponse(StreamingResponse):
    async def stream_response(self, send):
        async with aclosing(self.body_iterator):
            await super().stream_response(send)


@app.post("/api/chat/stream")
async def chat_stream(body: ChatBody):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Empty message")

    async def event_stream():
        try:
            run = _begin_chat(body)
        except HTTPException as exc:
            yield f"data: {json.dumps({'error': exc.detail})}\n\n"
            return
        parts = []
        error = None
        try:
            async with aclosing(manager.tokens(run.messages)) as tokens:
                async for token in tokens:
                    parts.append(token)
                    yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as exc:
            log.exception("chat stream failed")
            error = str(exc)
        finally:
            _finish_chat(run, "".join(parts))
        if error:
            yield f"data: {json.dumps({'error': error})}\n\n"
        yield "data: [DONE]\n\n"

    return ChatResponse(event_stream(), media_type="text/event-stream")


def main() -> None:
    import multiprocessing

    import uvicorn

    multiprocessing.freeze_support()  # no-op unless frozen (PyInstaller on Windows)
    print(f"Simpld backend on http://127.0.0.1:{config.PORT}", flush=True)
    # Pass the app object (not an import string) so frozen executables,
    # which have no normal import system, can still serve.
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=config.PORT, log_level="info",
        timeout_graceful_shutdown=2,
    ))
    if os.environ.get("SIMPLD_WATCH_STDIN") == "1":
        def watch_parent():
            # Electron owns the write end and closes it when quitting.
            sys.stdin.buffer.read()
            server.should_exit = True

        threading.Thread(target=watch_parent, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
