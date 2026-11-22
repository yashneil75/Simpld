"""Lifecycle and chat transport for the local llama.cpp server."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
from contextlib import suppress
from enum import StrEnum
from pathlib import Path

import httpx

from backend import config, download


class Phase(StrEnum):
    UNLOADED = "unloaded"
    LOADING = "loading"
    READY = "ready"
    FAILED = "failed"
    UNLOADING = "unloading"


class ModelManager:
    def __init__(self):
        self.name = config.DEFAULT_MODEL
        self.phase = Phase.UNLOADED
        self.error: str | None = None
        self._load_task: asyncio.Task | None = None
        self._process: subprocess.Popen | None = None
        self._client: httpx.AsyncClient | None = None

    def status(self) -> dict:
        if self.phase == Phase.READY and self._process.poll() is not None:
            self.phase = Phase.FAILED
            self.error = "llama-server exited. See llama-server.log in the model folder."
        return {
            "current": self.name,
            "phase": self.phase,
            "error": self.error,
            "running": self.phase == Phase.READY,
            "loading": self.phase == Phase.LOADING,
            "mock": False,
            "tiers": [
                {"name": name, "label": spec["label"], "description": spec["description"]}
                for name, spec in config.MODELS.items()
            ],
        }

    def select(self, name: str) -> dict:
        # The catalogue currently exposes one supported runtime configuration.
        if name != self.name:
            raise ValueError(f"Unknown model {name!r}. Available: {self.name}")
        return self.status()

    def load_in_background(self) -> dict:
        self.status()
        if self.phase in {Phase.UNLOADED, Phase.FAILED}:
            self.phase, self.error = Phase.LOADING, None
            self._load_task = asyncio.create_task(self._load())
        return self.status()

    async def _load(self) -> None:
        try:
            await self._close_runtime()
            executable = os.environ.get("SIMPLD_LLAMA_SERVER")
            if executable is None and getattr(sys, "frozen", False):
                name = "llama-server.exe" if os.name == "nt" else "llama-server"
                bundled = Path(sys.executable).parent / "llama" / name
                if bundled.is_file():
                    executable = str(bundled)
            executable = executable or shutil.which("llama-server")
            if not executable or not Path(executable).is_file():
                raise RuntimeError("Install a llama-server or set SIMPLD_LLAMA_SERVER to its executable.")
            executable = str(Path(executable).resolve())
            path = await download.download_for_runtime(self.name)
            env = os.environ.copy()
            if sys.platform.startswith("linux"):
                libraries = [str(Path(executable).parent)]
                original = env.pop("LD_LIBRARY_PATH_ORIG", None) if getattr(sys, "frozen", False) else env.get("LD_LIBRARY_PATH")
                if original:
                    libraries.append(original)
                env["LD_LIBRARY_PATH"] = os.pathsep.join(libraries)
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            key = secrets.token_urlsafe(32)
            with (config.MODEL_DIR / "llama-server.log").open("wb") as log:
                self._process = subprocess.Popen([
                    executable, "--model", str(path.resolve()), "--host", "127.0.0.1",
                    "--port", str(port), "--api-key", key, "--ctx-size",
                    str(config.MODELS[self.name]["ctx"]), "--parallel", "1",
                    "--cache-type-k", "q4_0", "--cache-type-v", "q4_0",
                    "--reasoning-format", "deepseek-legacy", "--reasoning-budget", "1024", "--no-webui",
                ], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), env=env)
            self._client = httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{port}",
                headers={"Authorization": f"Bearer {key}"},
                timeout=httpx.Timeout(120, connect=2),
                trust_env=False,
            )
            async with asyncio.timeout(300):
                while self._process.poll() is None:
                    try:
                        response = await self._client.get("/health", timeout=2)
                        if response.status_code == 200:
                            self.phase = Phase.READY
                            return
                    except httpx.RequestError:
                        pass
                    await asyncio.sleep(0.25)
            raise RuntimeError("llama-server exited during load. See llama-server.log in the model folder.")
        except Exception as exc:
            await self._close_runtime()
            self.error = str(exc) or "The model took too long to load."
            self.phase = Phase.FAILED

    async def tokens(self, messages: list[dict]):
        self.load_in_background()
        if self.phase == Phase.LOADING:
            await asyncio.shield(self._load_task)
        if self.phase != Phase.READY:
            raise RuntimeError(self.error or "Model unavailable.")
        history = [
            {"role": message["role"], "content": message["content"]}
            for message in messages
            if message.get("role") in {"system", "user", "assistant"}
            and isinstance(message.get("content"), str)
        ]
        async with self._client.stream("POST", "/v1/chat/completions", json={
            "messages": history, "stream": True, "max_tokens": 4096,
        }) as response:
            if response.is_error:
                await response.aread()
                raise RuntimeError(response.text)
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    return
                chunk = json.loads(payload)
                if chunk.get("error"):
                    raise RuntimeError(str(chunk["error"]))
                for choice in chunk.get("choices", []):
                    if token := choice.get("delta", {}).get("content"):
                        yield token
            raise RuntimeError("llama-server ended its response early.")

    async def delete_weights(self, name: str) -> bool:
        self.select(name)
        if self.phase in {Phase.LOADING, Phase.UNLOADING}:
            raise RuntimeError("Wait for the model operation to finish before deleting it.")
        self.phase = Phase.UNLOADING
        try:
            await self._close_runtime()
            return download.delete(name)
        finally:
            self.phase, self.error = Phase.UNLOADED, None

    async def close(self) -> None:
        if self._load_task is not None:
            self._load_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._load_task
        await self._close_runtime()
        self.phase, self.error = Phase.UNLOADED, None

    async def _close_runtime(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        if self._process is not None:
            if self._process.poll() is None:
                with suppress(ProcessLookupError):
                    self._process.kill()
            await asyncio.to_thread(self._process.wait)
            self._process = None


manager = ModelManager()
