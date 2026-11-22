import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend import local_tools, tool_chat


class ToolPermissionsTest(unittest.IsolatedAsyncioTestCase):
    def manager(self, name="write_file", parameters=None):
        params = parameters or {"path": "example.txt", "content": "hello"}
        class Manager:
            rounds = 0
            async def tokens(self, history, **kwargs):
                self.rounds += 1
                if self.rounds == 1:
                    yield f'<tool_call><function={name}>' + ''.join(f'<parameter={key}>{value}</parameter>' for key, value in params.items()) + '</function></tool_call>'
                else:
                    yield 'Finished.'
        return Manager()

    async def test_denial_does_not_execute_and_is_returned_to_model(self):
        approvals, activity, history = {}, [], []
        with patch.object(local_tools, 'execute', new_callable=AsyncMock) as execute:
            async for event in tool_chat.events(self.manager(), [], 'medium', activity, history, project='.', approvals=approvals):
                if 'approval' in event:
                    execute.assert_not_called()
                    approvals[event['approval']['id']].set_result(False)
        execute.assert_not_called()
        self.assertEqual(activity[0]['status'], 'denied')
        self.assertIn('User denied', history[-1]['content'])
        self.assertEqual(approvals, {})

    async def test_approval_executes_once_and_clears_pending(self):
        approvals = {}
        with patch.object(local_tools, 'execute', new_callable=AsyncMock, return_value={}) as execute:
            async for event in tool_chat.events(self.manager(), [], 'medium', [], [], project='.', approvals=approvals):
                if 'approval' in event:
                    execute.assert_not_called()
                    approvals[event['approval']['id']].set_result(True)
        execute.assert_awaited_once()
        self.assertEqual(approvals, {})

    async def test_mode_permissions(self):
        for mode, name, params in [
            ('read_only', 'read_file', {'path': 'file'}),
            ('read_only', 'search_web', {'query': 'hello'}),
            ('accept_edits', 'write_file', {'path': 'file', 'content': ''}),
            ('accept_edits', 'edit_file', {'path': 'file', 'old_text': 'a', 'new_text': 'b'}),
            ('allow_all', 'shell', {'command': 'echo hello'}),
        ]:
            with self.subTest(mode=mode, name=name), patch.object(local_tools, 'execute', new_callable=AsyncMock, return_value={}) as execute:
                events = [event async for event in tool_chat.events(self.manager(name, params), [], 'medium', [], [], project='.', permission_mode=mode)]
                self.assertFalse(any('approval' in event for event in events))
                execute.assert_awaited_once()

    async def test_cancellation_clears_approval(self):
        approvals = {}
        async def run():
            async for _ in tool_chat.events(self.manager(), [], 'medium', [], [], project='.', approvals=approvals):
                pass
        task = asyncio.create_task(run())
        while not approvals:
            await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(approvals, {})

    async def test_real_file_tools_preserve_whitespace_and_reject_ambiguous_edit(self):
        with tempfile.TemporaryDirectory() as project:
            content = '\n  hello\r\n'
            await local_tools.execute('write_file', {'path': 'nested/file.txt', 'content': content}, project)
            result = await local_tools.execute('read_file', {'path': 'nested/file.txt'}, project)
            self.assertEqual(result['content'], content)
            await local_tools.execute('edit_file', {'path': 'nested/file.txt', 'old_text': 'hello', 'new_text': 'world'}, project)
            self.assertEqual((Path(project) / 'nested/file.txt').read_bytes(), b'\n  world\r\n')
            with self.assertRaises(ValueError):
                await local_tools.execute('edit_file', {'path': 'nested/file.txt', 'old_text': '', 'new_text': 'oops'}, project)

    def test_xml_preserves_file_content(self):
        call = tool_chat.parse_calls('<tool_call><function=write_file><parameter=path>a.txt</parameter><parameter=content>\n  text\n</parameter></function></tool_call>')[0]
        self.assertEqual(call['arguments']['content'], '\n  text\n')

    async def test_shell_returns_command_output_and_exit_code(self):
        with tempfile.TemporaryDirectory() as project:
            result = await local_tools.execute('shell', {'command': 'echo simpld-tool-check'}, project)
        self.assertEqual(result['exit_code'], 0)
        self.assertIn('simpld-tool-check', result['output'])
