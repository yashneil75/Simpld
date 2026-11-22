"""Local llama-cpp-python inference, serialized on a dedicated worker thread."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from enum import StrEnum
from functools import partial
from pathlib import Path

from anyio import CancelScope

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
        self._llm = None
        self._chat_handler = None
        self._worker: ThreadPoolExecutor | None = None
        self._runtime_lock = asyncio.Lock()

    def status(self) -> dict:
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
        if name != self.name:
            raise ValueError(f"Unknown model {name!r}. Available: {self.name}")
        return self.status()

    def load_in_background(self) -> dict:
        if self.phase in {Phase.UNLOADED, Phase.FAILED}:
            self.phase, self.error = Phase.LOADING, None
            self._load_task = asyncio.create_task(self._load())
        return self.status()

    async def _run(self, function, *args):
        if self._worker is None:
            self._worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="simpld-llama")
        future = asyncio.get_running_loop().run_in_executor(self._worker, function, *args)
        # Starlette cancels disconnected streams with an AnyIO cancel scope.
        # Shield cleanup from repeated cancellation at each await as well.
        with CancelScope(shield=True):
            try:
                return await asyncio.shield(future)
            except asyncio.CancelledError:
                # Native calls cannot be cancelled. Finish before releasing the
                # lock so requests cannot use or free a context still in flight.
                with suppress(Exception):
                    await future
                raise

    def _open_runtime(self, path: Path) -> None:
        from llama_cpp import GGML_TYPE_Q4_0, Llama
        from llama_cpp.llama_chat_format import Jinja2ChatFormatter

        self._llm = Llama(
            model_path=str(path.resolve()),
            n_ctx=config.MODELS[self.name]["ctx"],
            n_gpu_layers=-1,
            flash_attn=True,
            type_k=GGML_TYPE_Q4_0,
            type_v=GGML_TYPE_Q4_0,
            swa_full=False,
            verbose=False,
        )
        eos = self._llm.token_eos()
        bos = self._llm.token_bos()
        self._chat_handler = Jinja2ChatFormatter(
            template=self._llm.metadata["tokenizer.chat_template"],
            eos_token=self._llm.detokenize([eos], special=True).decode("utf-8") if eos >= 0 else "",
            bos_token=self._llm.detokenize([bos], special=True).decode("utf-8") if bos >= 0 else "",
            stop_token_ids=[eos] if eos >= 0 else [],
        ).to_chat_handler()

    def _close_runtime(self) -> None:
        if self._llm is not None:
            self._llm.close()
            self._llm = None
        self._chat_handler = None

    async def _load(self) -> None:
        try:
            path = await download.download_for_runtime(self.name)
            async with self._runtime_lock:
                await self._run(self._close_runtime)
                await self._run(self._open_runtime, path)
                self.phase = Phase.READY
        except asyncio.CancelledError:
            async with self._runtime_lock:
                await self._run(self._close_runtime)
            raise
        except Exception as exc:
            async with self._runtime_lock:
                await self._run(self._close_runtime)
            self.error = str(exc) or "The model could not be loaded."
            self.phase = Phase.FAILED

    async def tokens(self, messages: list[dict], reasoning_level: str = "medium"):
        if reasoning_level not in config.REASONING_LEVELS:
            raise ValueError("Unknown reasoning level.")
        self.load_in_background()
        if self.phase == Phase.LOADING:
            await asyncio.shield(self._load_task)
        history = [
            {"role": message["role"], "content": message["content"]}
            for message in messages
            if message.get("role") in {"system", "user", "assistant"}
            and isinstance(message.get("content"), str)
        ]
        for message in history:
            if message["role"] == "assistant" and message["content"].startswith("<think>"):
                reasoning, separator, answer = message["content"][len("<think>"):].partition("</think>")
                message["reasoning_content"] = reasoning.strip()
                message["content"] = answer.lstrip() if separator else ""
        async with self._runtime_lock:
            if self.phase != Phase.READY:
                raise RuntimeError(self.error or "Model unavailable.")
            stream = None

            def start_stream():
                nonlocal stream
                # create_chat_completion has no chat_template_kwargs parameter.
                # Bind native template variables through its supported handler API.
                self._llm.chat_handler = partial(
                    self._chat_handler, reasoning_effort=reasoning_level,
                    enable_thinking=True, preserve_thinking=True,
                )
                stream = self._llm.create_chat_completion(
                    messages=history, stream=True, max_tokens=4096,
                )

            try:
                await self._run(start_stream)
                # The GGUF prompt opens <think> before generation starts. Put
                # that marker back so the UI can stream reasoning in its toggle.
                needs_think_marker = config.MODELS[self.name].get("reasoning", False)
                # StopIteration cannot cross an asyncio Future boundary.
                while (chunk := await self._run(next, stream, None)) is not None:
                    if chunk.get("error"):
                        raise RuntimeError(str(chunk["error"]))
                    for choice in chunk.get("choices", []):
                        if token := choice.get("delta", {}).get("content"):
                            if needs_think_marker:
                                token = "<think>\n" + token
                                needs_think_marker = False
                            yield token
            finally:
                if stream is not None:
                    await self._run(stream.close)

    async def delete_weights(self, name: str) -> bool:
        self.select(name)
        if self.phase in {Phase.LOADING, Phase.UNLOADING}:
            raise RuntimeError("Wait for the model operation to finish before deleting it.")
        self.phase = Phase.UNLOADING
        try:
            async with self._runtime_lock:
                await self._run(self._close_runtime)
                return await asyncio.to_thread(download.delete, name)
        finally:
            self.phase, self.error = Phase.UNLOADED, None

    async def close(self) -> None:
        self.phase = Phase.UNLOADING
        if self._load_task is not None:
            self._load_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._load_task
            self._load_task = None
        async with self._runtime_lock:
            await self._run(self._close_runtime)
            self._worker.shutdown(wait=True)
            self._worker = None
        self.phase, self.error = Phase.UNLOADED, None


manager = ModelManager()
