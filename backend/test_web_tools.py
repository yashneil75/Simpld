import unittest
from unittest.mock import patch

from backend import tool_chat, web_tools


class WebToolsTest(unittest.TestCase):
    def test_parses_qwen_coder_xml_calls(self):
        for text in [
            '<tool_call><function=search_web><parameter=query>hello</parameter></function></tool_call>',
            '<tool_call>\n<function=search_web>\n<parameter=query>hello</parameter>\n</function>\n</tool_call>',
        ]:
            call = tool_chat.parse_calls(text)[0]
            self.assertEqual(call["function"]["name"], "search_web")
            self.assertEqual(call["arguments"], {"query": "hello"})

    def test_multiple_calls_and_literal_url_query(self):
        text = '<tool_call><function=web_fetch><parameter=url>https://example.com/?a=1&b=2</parameter></function></tool_call>'
        calls = tool_chat.parse_calls(text + text)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]['arguments']['url'], 'https://example.com/?a=1&b=2')
        self.assertNotEqual(calls[0]['id'], calls[1]['id'])

    def test_rejects_json_incomplete_and_malformed_calls(self):
        for text in [
            '<tool_call>{"name":"search_web","arguments":{"query":"hello"}}</tool_call>',
            '<tool_call><function=search_web>',
            '<tool_call><function=search_web><parameter=query>hello</function></tool_call>',
            '<tool_call><function=search_web><parameter=query>a</parameter><parameter=query>b</parameter></function></tool_call>',
        ]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                tool_chat.parse_calls(text)

    def test_reasoning_is_not_executed(self):
        self.assertEqual(tool_chat.parse_calls('<think><tool_call>example</tool_call></think>Answer'), [])
        self.assertEqual(tool_chat.parse_calls('<think><tool_call>example'), [])

    def test_rejects_private_urls_and_unknown_tools(self):
        with patch.object(web_tools.socket, "getaddrinfo", return_value=[(0, 0, 0, '', ('127.0.0.1', 80))]):
            with self.assertRaises(ValueError):
                web_tools.public_url('http://localhost/')
        for url in ['file:///etc/passwd', 'https://user:pass@example.com', 'http://example.com:8000']:
            with self.assertRaises(ValueError):
                web_tools.public_url(url)
        with self.assertRaises(ValueError):
            web_tools.execute('shell', {'command': 'echo hello'})

    def test_extracts_visible_html(self):
        parser = web_tools.PageText()
        parser.feed('<h1>Title</h1><script>hidden</script><p>Hello &amp; world</p>')
        text = ''.join(parser.parts)
        self.assertIn('Hello & world', text)
        self.assertNotIn('hidden', text)


class ToolChatTest(unittest.IsolatedAsyncioTestCase):
    async def test_tool_example_in_reasoning_does_not_execute(self):
        class Manager:
            async def tokens(self, history, **kwargs):
                yield '<think>Example: <tool_'
                yield 'call>not a real call</tool_call></think>Answer'
        with patch.object(web_tools, 'execute') as execute:
            events = [event async for event in tool_chat.events(Manager(), [], 'medium', [], [])]
        execute.assert_not_called()
        self.assertIn('Answer', ''.join(event.get('token', '') for event in events))

    async def test_split_call_is_hidden_and_result_used_for_answer(self):
        class Manager:
            calls = 0
            async def tokens(self, history, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    for token in ['<think>search</think>', '<tool_', 'call><function=search_web><parameter=query>test</parameter></function></tool_call>']:
                        yield token
                else:
                    self.history = history
                    yield '<think>done</think>Answer'
        manager = Manager()
        activity, history = [], []
        with patch.object(web_tools, 'execute', return_value={'results': []}):
            events = [event async for event in tool_chat.events(manager, [{'role':'user','content':'test'}], 'medium', activity, history)]
        self.assertEqual(activity[0]['status'], 'done')
        self.assertEqual(history[-1]['role'], 'tool')
        self.assertTrue(any(event.get('reset') for event in events))
        self.assertEqual(activity[0]['type'], 'message')
        self.assertEqual(activity[0]['content'], '<think>search</think>')
        self.assertEqual(activity[1]['name'], 'search_web')
        self.assertFalse(any('<tool_' in event.get('token', '') for event in events))
        self.assertEqual(events[-1]['token'], '<think>done</think>Answer')

    async def test_tool_failure_returns_to_model(self):
        class Manager:
            calls = 0
            async def tokens(self, history, **kwargs):
                self.calls += 1
                yield '<tool_call><function=web_fetch><parameter=url>https://example.com</parameter></function></tool_call>' if self.calls == 1 else 'Could not fetch.'
        activity, history = [], []
        with patch.object(web_tools, 'execute', side_effect=ValueError('blocked')):
            _ = [event async for event in tool_chat.events(Manager(), [], 'medium', activity, history)]
        self.assertEqual(activity[0]['status'], 'error')
        self.assertIn('blocked', history[-1]['content'])
