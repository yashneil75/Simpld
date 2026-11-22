"""Conversation isolation and stream cleanup through the API."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from backend import app as backend
from backend.model import ModelManager, Phase
from backend.store import Store


class HistoryTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        store = Store(Path(temp.name) / "test.db")
        store.ensure_project("first")
        values = patch.multiple(
            backend, store=store, _project="first", _conversation=None,
            _active_chat=None, _session_revision=0,
        )
        values.start()
        self.addCleanup(values.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=backend.app),
            base_url="http://127.0.0.1",
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_context_follows_the_persisted_conversation(self):
        seen = []

        async def tokens(history):
            seen.append([message["content"] for message in history])
            yield "reply"

        with patch.object(backend.manager, "tokens", tokens):
            first = await self.client.post("/api/chat", json={"content": "first prompt"})
            await self.client.post("/api/projects/open", json={"path": "second"})
            await self.client.post("/api/chat", json={"content": "second prompt"})
            first_id = first.json()["conversation"]
            await self.client.post(f"/api/conversations/{first_id}/open")
            streamed = await self.client.post("/api/chat/stream", json={"content": "continuation"})

        self.assertEqual(seen, [["first prompt"], ["second prompt"], ["first prompt", "reply", "continuation"]])
        self.assertIn("data: [DONE]", streamed.text)
        snapshot = (await self.client.get("/api/session")).json()
        self.assertEqual(snapshot["currentChat"], first_id)
        self.assertEqual(snapshot["messages"][-1]["content"], "reply")

    async def test_missing_chat_and_stale_prompt_preserve_current_project(self):
        missing = await self.client.post("/api/conversations/999/open")
        self.assertEqual(missing.status_code, 404)
        await self.client.post("/api/projects/open", json={"path": "second"})
        stale = await self.client.post("/api/chat", json={"content": "old prompt", "revision": 0})
        self.assertEqual(stale.status_code, 409)
        snapshot = (await self.client.get("/api/session")).json()
        self.assertEqual(snapshot["currentProject"], "second")
        self.assertEqual(snapshot["messages"], [])

    async def test_stream_close_saves_partial_and_releases_generation(self):
        async def tokens(_history):
            yield "partial"
            await asyncio.Event().wait()

        with patch.object(backend.manager, "tokens", tokens):
            response = await backend.chat_stream(backend.ChatBody(content="prompt"))
            sent = []

            async def disconnect_send(event):
                sent.append(event)
                if event["type"] == "http.response.body":
                    raise OSError("client disconnected")

            with self.assertRaises(OSError):
                await response.stream_response(disconnect_send)
        self.assertIn(b"partial", sent[-1]["body"])
        self.assertIsNone(backend._active_chat)
        snapshot = (await self.client.get("/api/session?settled=true")).json()
        self.assertEqual([msg["content"] for msg in snapshot["messages"]], ["prompt", "partial"])

    async def test_load_or_generation_errors_surface_over_sse(self):
        async def tokens(_history):
            raise RuntimeError("load failed")
            yield

        with patch.object(backend.manager, "tokens", tokens):
            with self.assertLogs("simpld.backend", level="ERROR"):
                response = await self.client.post("/api/chat/stream", json={"content": "prompt"})
        self.assertIn('data: {"error": "load failed"}', response.text)
        self.assertIsNone(backend._active_chat)

    async def test_load_failure_is_retryable_with_one_worker(self):
        runtime = ModelManager()
        self.addAsyncCleanup(runtime.close)
        with patch.dict("os.environ", {"SIMPLD_LLAMA_SERVER": "missing-llama-server.exe"}):
            self.assertEqual(runtime.load_in_background()["phase"], Phase.LOADING)
            task = runtime._load_task
            runtime.load_in_background()
            self.assertIs(runtime._load_task, task)
            await task
            self.assertEqual(runtime.status()["phase"], Phase.FAILED)
            self.assertIn("SIMPLD_LLAMA_SERVER", runtime.status()["error"])
            self.assertEqual(runtime.load_in_background()["phase"], Phase.LOADING)
            self.assertIsNot(runtime._load_task, task)
            await runtime._load_task

    async def test_runtime_consumes_chat_stream_and_skips_non_text_chunks(self):
        def transport(request):
            self.assertEqual(request.url.path, "/v1/chat/completions")
            self.assertEqual(json.loads(request.content)["messages"], [
                {"role": "user", "content": "prompt"},
            ])
            return httpx.Response(200, text=(
                'data: {"choices": []}\n\n'
                'data: {"choices": [{"delta": {"content": "reply"}}]}\n\n'
                'data: [DONE]\n\n'
            ))

        runtime = ModelManager()
        runtime.phase = Phase.READY
        runtime._process = SimpleNamespace(poll=lambda: None)
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(transport), base_url="http://127.0.0.1",
        ) as client:
            runtime._client = client
            reply = [token async for token in runtime.tokens([
                {"role": "tool", "content": "ignored"},
                {"role": "user", "content": "prompt"},
            ])]
        self.assertEqual(reply, ["reply"])
