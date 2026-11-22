"""Native inference lifecycle, streaming, and cancellation safety."""

import asyncio
import threading
import unittest
from contextlib import aclosing
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from anyio import CancelScope
from llama_cpp import Llama

from backend import config
from backend.model import ModelManager, Phase


class ModelTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = ModelManager()
        self.llm = MagicMock()
        self.llm.metadata = {"tokenizer.chat_template": "{{ reasoning_effort }}"}
        self.llm.token_eos.return_value = 2
        self.llm.token_bos.return_value = 1
        self.llm.detokenize.return_value = b"<|im_end|>"
        self.factory = MagicMock(return_value=self.llm)
        patches = [
            patch("llama_cpp.Llama", self.factory),
            patch("backend.model.download.download_for_runtime", new=AsyncMock(
                return_value=Path("model.gguf"),
            )),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addAsyncCleanup(self.runtime.close)

    async def load(self):
        self.runtime.load_in_background()
        await self.runtime._load_task
        self.assertEqual(self.runtime.phase, Phase.READY)

    async def test_switch_unloads_previous_model_and_loads_ornith(self):
        await self.load()
        status = await self.runtime.select("Ornith-1.5-9B")
        self.llm.close.assert_called_once()
        self.assertEqual(status["current"], "Ornith-1.5-9B")
        self.assertEqual(status["phase"], Phase.UNLOADED)
        await self.load()
        self.assertEqual(self.factory.call_count, 2)

    async def test_switch_rejects_unknown_models_and_busy_runtime(self):
        with self.assertRaises(ValueError):
            await self.runtime.select("unknown")
        self.runtime.phase = Phase.LOADING
        with self.assertRaises(RuntimeError):
            await self.runtime.select("Ornith-1.5-9B")
        self.assertEqual(self.runtime.name, config.DEFAULT_MODEL)

    async def test_ornith_uses_its_sampling_without_effort_override(self):
        await self.runtime.select("Ornith-1.5-9B")
        self.llm.create_chat_completion.return_value = (chunk for chunk in [])
        _ = [token async for token in self.runtime.tokens([{"role": "user", "content": "hello"}])]
        self.assertNotIn("reasoning_effort", self.llm.chat_handler.keywords)
        self.assertTrue(self.llm.chat_handler.keywords["enable_thinking"])
        self.assertEqual(self.llm.create_chat_completion.call_args.kwargs["temperature"], 0.6)

    async def test_load_failure_is_retryable_with_one_worker(self):
        self.factory.side_effect = [RuntimeError("unsupported model"), self.llm]
        self.assertEqual(self.runtime.load_in_background()["phase"], Phase.LOADING)
        task = self.runtime._load_task
        self.runtime.load_in_background()
        self.assertIs(self.runtime._load_task, task)
        await task
        self.assertEqual(self.runtime.status()["phase"], Phase.FAILED)
        self.assertEqual(self.runtime.status()["error"], "unsupported model")
        await self.load()
        self.assertIsNot(self.runtime._load_task, task)
        self.assertIsNone(self.runtime.status()["error"])
        self.factory.assert_called_with(
            model_path=str(Path("model.gguf").resolve()),
            n_ctx=config.MODELS[config.DEFAULT_MODEL]["ctx"], n_gpu_layers=-1,
            flash_attn=True, type_k=2, type_v=2, swa_full=False, verbose=False,
        )

    async def test_stream_preserves_reasoning_markers_and_conversation(self):
        closed = []

        def chunks(**kwargs):
            self.assertEqual(kwargs["messages"], [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "prompt"},
                {"role": "assistant", "content": "previous reply"},
                {"role": "user", "content": "continue"},
            ])
            try:
                yield {"choices": []}
                yield {"choices": [{"delta": {"role": "assistant"}}]}
                yield {"choices": [{"delta": {"reasoning_content": "hidden"}}]}
                yield {"choices": [{"delta": {"content": "private reasoning</thi"}}]}
                yield {"choices": [{"delta": {"content": "nk>"}}]}
                yield {"choices": [{"delta": {"content": "reply"}}]}
                yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}
            finally:
                closed.append(True)

        self.llm.create_chat_completion.side_effect = chunks
        reply = [token async for token in self.runtime.tokens([
            {"role": "tool", "content": "ignored"},
            {"role": "system", "content": "system", "extra": "ignored"},
            {"role": "user", "content": "prompt"},
            {"role": "assistant", "content": "previous reply"},
            {"role": "user", "content": "continue"},
            {"role": "user", "content": None},
        ])]
        self.assertEqual(reply, ["<think>\nprivate reasoning</thi", "nk>", "reply"])
        self.assertEqual(closed, [True])

    async def test_closing_partial_stream_releases_model_for_next_request(self):
        closed = []

        def chunks(**_kwargs):
            try:
                yield {"choices": [{"delta": {"content": "</think>partial"}}]}
                self.fail("A disconnected stream should not request more tokens")
            finally:
                closed.append(True)

        self.llm.create_chat_completion.side_effect = chunks
        for _ in range(2):
            stream = self.runtime.tokens([{"role": "user", "content": "prompt"}])
            self.assertEqual(await anext(stream), "<think>\n</think>partial")
            await stream.aclose()
        self.assertEqual(closed, [True, True])

    async def test_generation_error_closes_stream_and_allows_retry(self):
        closed = []

        def chunks(**_kwargs):
            try:
                raise RuntimeError("context full")
                yield
            finally:
                closed.append(True)

        self.llm.create_chat_completion.side_effect = chunks
        for _ in range(2):
            with self.assertRaisesRegex(RuntimeError, "context full"):
                await anext(self.runtime.tokens([]))
        self.assertEqual(closed, [True, True])

    async def test_model_without_reasoning_streams_content_immediately(self):
        def chunks(**_kwargs):
            yield {"choices": [{"delta": {"content": "reply"}}]}

        self.llm.create_chat_completion.side_effect = chunks
        with patch.dict(config.MODELS[self.runtime.name], reasoning=False):
            self.assertEqual([token async for token in self.runtime.tokens([])], ["reply"])

    async def test_native_reasoning_levels_reach_template_without_mutating_history(self):
        def chunks(**_kwargs):
            yield {"choices": [{"delta": {"content": "</think>reply"}}]}

        self.llm.create_chat_completion.side_effect = chunks
        for level in config.REASONING_LEVELS:
            for existing_system in (False, True):
                history = [{"role": "user", "content": "prompt"}]
                if existing_system:
                    history.insert(0, {"role": "system", "content": "Original instructions"})
                original = [dict(message) for message in history]
                _ = [token async for token in self.runtime.tokens(history, reasoning_level=level)]
                messages = self.llm.create_chat_completion.call_args.kwargs["messages"]
                self.assertEqual(messages, original)
                self.assertEqual(self.llm.chat_handler.keywords, {"reasoning_effort": level, "enable_thinking": True, "preserve_thinking": True})
                self.assertEqual(history, original)

    async def test_saved_reasoning_is_passed_as_native_reasoning_content(self):
        def chunks(**_kwargs):
            yield {"choices": [{"delta": {"content": "</think>next answer"}}]}

        self.llm.create_chat_completion.side_effect = chunks
        history = [
            {"role": "user", "content": "first prompt"},
            {"role": "assistant", "content": "<think>\nprevious reasoning</think>previous answer"},
            {"role": "user", "content": "continue"},
        ]
        _ = [token async for token in self.runtime.tokens(history)]
        messages = self.llm.create_chat_completion.call_args.kwargs["messages"]
        self.assertEqual(messages[1], {"role": "assistant", "reasoning_content": "previous reasoning", "content": "previous answer"})
        self.assertTrue(history[1]["content"].startswith("<think>"))

    async def test_native_handler_renders_selected_effort_through_llama_api(self):
        self.llm.metadata["tokenizer.chat_template"] = "{{ reasoning_effort }}|{{ enable_thinking }}|{{ preserve_thinking }}"
        self.llm.tokenize.return_value = [1]
        self.llm.create_chat_completion.side_effect = lambda **kwargs: Llama.create_chat_completion(self.llm, **kwargs)

        def completion(**_kwargs):
            yield {"id": "completion", "created": 0, "model": "test", "choices": [
                {"text": "</think>answer", "finish_reason": None, "logprobs": None},
            ]}

        self.llm.create_completion.side_effect = completion
        for level in config.REASONING_LEVELS:
            reply = [token async for token in self.runtime.tokens([{"role": "user", "content": "prompt"}], reasoning_level=level)]
            self.assertEqual(reply, ["<think>\n</think>answer"])
            self.assertEqual(self.llm.tokenize.call_args.args[0], f"{level}|True|True".encode())

    async def test_native_template_renders_saved_tool_arguments_as_mapping(self):
        import copy
        import json

        self.llm.metadata['tokenizer.chat_template'] = (
            '{% for message in messages %}{% for call in message.tool_calls|default([]) %}'
            '{% for key, value in call.function.arguments|items %}{{ key }}={{ value }};{% endfor %}'
            '{% endfor %}{% endfor %}'
        )
        self.llm.tokenize.return_value = [1]
        self.llm.create_chat_completion.side_effect = lambda **kwargs: Llama.create_chat_completion(self.llm, **kwargs)

        def completion(**_kwargs):
            yield {'id': 'completion', 'created': 0, 'model': 'test', 'choices': [
                {'text': '</think>answer', 'finish_reason': None, 'logprobs': None},
            ]}
        self.llm.create_completion.side_effect = completion
        for arguments in [json.dumps({'path': 'file.txt', 'content': '\n  text\n'}), {'path': 'file.txt', 'content': '\n  text\n'}]:
            history = [
                {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'call-1', 'type': 'function', 'function': {'name': 'write_file', 'arguments': arguments}}]},
                {'role': 'tool', 'name': 'write_file', 'tool_call_id': 'call-1', 'content': '{"characters_written": 8}'},
            ]
            original = copy.deepcopy(history)
            reply = [token async for token in self.runtime.tokens(history)]
            self.assertEqual(reply, ['<think>\n</think>answer'])
            self.assertEqual(self.llm.tokenize.call_args.args[0], b'path=file.txt;content=\n  text\n;')
            self.assertEqual(history, original)

    async def test_cancelled_native_load_is_closed_before_shutdown_returns(self):
        entered, release = threading.Event(), threading.Event()
        events = []

        def constructor(**_kwargs):
            entered.set()
            release.wait(timeout=5)
            events.append("loaded")
            return self.llm

        self.factory.side_effect = constructor
        self.llm.close.side_effect = lambda: events.append("closed")
        self.runtime.load_in_background()
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 5))
            close = asyncio.create_task(self.runtime.close())
            await asyncio.sleep(0.02)
            self.assertFalse(close.done())
        finally:
            release.set()
        await close
        self.assertEqual(events, ["loaded", "closed"])
        self.assertEqual(self.runtime.phase, Phase.UNLOADED)
        self.assertIsNone(self.runtime._llm)

    async def test_cancelled_token_finishes_before_stream_and_model_close(self):
        entered, release = threading.Event(), threading.Event()
        events, threads = [], set()
        main_thread = threading.get_ident()

        def record(event):
            threads.add(threading.get_ident())
            events.append(event)

        def constructor(**_kwargs):
            record("loaded")
            return self.llm

        def chunks(**_kwargs):
            record("generating")
            entered.set()
            try:
                release.wait(timeout=5)
                record("token")
                yield {"choices": [{"delta": {"content": "reply"}}]}
            finally:
                record("stream closed")

        self.factory.side_effect = constructor
        self.llm.create_chat_completion.side_effect = chunks
        self.llm.close.side_effect = lambda: record("model closed")
        stream = self.runtime.tokens([])
        generation = asyncio.create_task(anext(stream))
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 5))
            # The event loop stays responsive while next() is inside native code.
            self.assertTrue(self.runtime.status()["running"])
            generation.cancel()
            close = asyncio.create_task(self.runtime.close())
            await asyncio.sleep(0.02)
            self.assertFalse(generation.done())
            self.assertFalse(close.done())
        finally:
            release.set()
        with self.assertRaises(asyncio.CancelledError):
            await generation
        await close
        self.assertEqual(events, ["loaded", "generating", "token", "stream closed", "model closed"])
        self.assertEqual(len(threads), 1)
        self.assertNotIn(main_thread, threads)

    async def test_delete_closes_native_context_before_removing_weights(self):
        await self.load()

        def delete(_name):
            self.llm.close.assert_called_once()
            self.assertIsNone(self.runtime._llm)
            return True

        with patch("backend.model.download.delete", side_effect=delete):
            self.assertTrue(await self.runtime.delete_weights(self.runtime.name))
        self.assertEqual(self.runtime.phase, Phase.UNLOADED)

    async def test_anyio_disconnect_closes_stream_before_reusing_context(self):
        entered, release = threading.Event(), threading.Event()
        closed = []
        scope = None

        def chunks(**_kwargs):
            entered.set()
            try:
                release.wait(timeout=5)
                yield {"choices": [{"delta": {"content": "</think>reply"}}]}
            finally:
                closed.append(True)

        async def consume():
            nonlocal scope
            with CancelScope() as scope:
                async with aclosing(self.runtime.tokens([])) as stream:
                    async for _ in stream:
                        await asyncio.sleep(0)

        self.llm.create_chat_completion.side_effect = chunks
        consumer = asyncio.create_task(consume())
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 5))
            scope.cancel()
            await asyncio.sleep(0.02)
            self.assertFalse(consumer.done())
        finally:
            release.set()
        await asyncio.wait_for(consumer, timeout=5)
        self.assertEqual(closed, [True])
        self.assertEqual([token async for token in self.runtime.tokens([])], ["<think>\n</think>reply"])
