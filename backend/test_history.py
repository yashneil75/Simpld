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

        async def tokens(history, **_options):
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
        async def tokens(_history, **_options):
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
        async def tokens(_history, **_options):
            raise RuntimeError("load failed")
            yield

        with patch.object(backend.manager, "tokens", tokens):
            with self.assertLogs("simpld.backend", level="ERROR"):
                response = await self.client.post("/api/chat/stream", json={"content": "prompt"})
        self.assertIn('data: {"error": "load failed"}', response.text)
        self.assertIsNone(backend._active_chat)

    async def test_reasoning_streams_and_is_saved_for_the_thinking_dropdown(self):
        runtime = ModelManager()
        self.addAsyncCleanup(runtime.close)

        def chunks(**_kwargs):
            yield {"choices": [{"delta": {"content": "Working through it"}}]}
            yield {"choices": [{"delta": {"content": "</think>"}}]}
            yield {"choices": [{"delta": {"content": "The answer"}}]}

        runtime._llm = SimpleNamespace(create_chat_completion=chunks, close=lambda: None)
        runtime._chat_handler = lambda **_kwargs: None
        runtime.phase = Phase.READY
        with patch.object(backend, "manager", runtime):
            response = await self.client.post("/api/chat/stream", json={"content": "prompt"})
        tokens = [
            json.loads(line[5:])["token"]
            for line in response.text.splitlines()
            if line.startswith("data:") and line != "data: [DONE]"
        ]
        self.assertEqual(tokens, ["<think>\nWorking through it", "</think>", "The answer"])
        snapshot = (await self.client.get("/api/session")).json()
        self.assertEqual(snapshot["messages"][-1]["content"], "".join(tokens))

    async def test_reasoning_level_reaches_generation_and_rejects_invalid_values(self):
        seen = []

        async def tokens(_history, reasoning_level):
            seen.append(reasoning_level)
            yield "reply"

        with patch.object(backend.manager, "tokens", tokens):
            response = await self.client.post("/api/chat/stream", json={"content": "prompt", "reasoning_level": "xhigh"})
            self.assertEqual(response.status_code, 200)
            response = await self.client.post("/api/chat", json={"content": "prompt", "reasoning_level": "low"})
            self.assertEqual(response.status_code, 200)
            response = await self.client.post("/api/chat", json={"content": "prompt", "reasoning_level": "invalid"})
            self.assertEqual(response.status_code, 422)
        self.assertEqual(seen, ["xhigh", "low"])
