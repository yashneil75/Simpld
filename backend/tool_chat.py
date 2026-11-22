"""Stream model text and web activity; feed tool results back for an answer."""
import asyncio
import json
import re
from contextlib import aclosing
from uuid import uuid4
from datetime import date

from backend import local_tools

CALL = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.S)
FUNCTION = re.compile(r"<function=([A-Za-z_][A-Za-z0-9_]*)>\s*(.*?)\s*</function>", re.S)
PARAMETER = re.compile(r"<parameter=([A-Za-z_][A-Za-z0-9_]*)>(.*?)</parameter>", re.S)


def parse_calls(text):
    # Ignore tool-looking text inside the model's reasoning block.
    answer = re.sub(r"<think>.*?(?:</think>|$)", "", text, flags=re.S)
    calls = []
    if answer.count("<tool_call>") != len(CALL.findall(answer)):
        raise ValueError("Incomplete Qwen tool call.")
    for match in CALL.finditer(answer):
        body = match.group(1)
        function = FUNCTION.fullmatch(body)
        if not function:
            raise ValueError("Malformed Qwen tool call.")
        name, parameters = function.groups()
        arguments = {}
        position = 0
        for parameter in PARAMETER.finditer(parameters):
            if parameters[position:parameter.start()].strip():
                raise ValueError("Malformed Qwen tool parameter.")
            key, value = parameter.groups()
            if key in arguments:
                raise ValueError(f"Duplicate tool parameter: {key}")
            # These web tools take strings; preserve XML entities and URL query
            # strings verbatim. Qwen's format is not conventional XML.
            arguments[key] = value if key in {"content", "old_text", "new_text"} else value.strip()
            position = parameter.end()
        if parameters[position:].strip():
            raise ValueError("Malformed Qwen tool parameter.")
        calls.append({"id": uuid4().hex, "type": "function", "function": {
            "name": name, "arguments": json.dumps(arguments)}, "arguments": arguments})
    return calls


async def events(manager, messages, reasoning_level, activity, tool_history, current_date=None, project=None, permission_mode="read_only", approvals=None):
    history = []
    for message in messages:
        history.extend(message.get("tool_history", []))
        history.append({key: value for key, value in message.items() if key in {"role", "content"}})
    date_context = f"Current date: {current_date or date.today().isoformat()}."
    if project:
        date_context += f"\nCurrent project directory: {project}. Tool permissions: {permission_mode}. If a tool is denied, respect the decision and do not retry the action through another tool."
    if history and history[0]['role'] == 'system':
        history[0] = {**history[0], 'content': history[0]['content'] + '\n' + date_context}
    else:
        history.insert(0, {'role': 'system', 'content': date_context})
    for round_number in range(9):
        text = ""
        pending = ""
        hiding = False
        async with aclosing(manager.tokens(history, reasoning_level=reasoning_level, tools=local_tools.TOOLS)) as tokens:
            async for token in tokens:
                text += token
                pending += token
                if hiding:
                    pending = ""
                    continue
                if "<tool_call>" in pending:
                    offset = len(text) - len(pending) + pending.index("<tool_call>")
                    before_call = text[:offset]
                    if before_call.rfind("<think>") <= before_call.rfind("</think>"):
                        visible = pending.split("<tool_call>", 1)[0]
                        if visible:
                            yield {"token": visible}
                        pending = ""
                        hiding = True
                        continue
                # Hold back a possible partial opening tag across token boundaries.
                held = next((size for size in range(min(len(pending), 10), 0, -1)
                             if "<tool_call>".startswith(pending[-size:])), 0)
                visible = pending[:-held] if held else pending
                pending = pending[-held:] if held else ""
                if visible:
                    yield {"token": visible}
        if pending and not hiding:
            yield {"token": pending}
        calls = parse_calls(text)
        if not calls:
            if hiding:
                raise ValueError("The model produced an incomplete tool call. Please retry.")
            return
        if round_number == 8:
            raise RuntimeError("Tool limit reached. Ask a follow-up to continue.")
        assistant = {"role": "assistant", "content": CALL.sub("", text), "tool_calls": [
            {key: value for key, value in call.items() if key != "arguments"} for call in calls]}
        history.append(assistant)
        tool_history.append(assistant)
        if assistant['content'].strip():
            entry = {'id': uuid4().hex, 'type': 'message', 'content': assistant['content'], 'status': 'done'}
            activity.append(entry)
            yield {'activity_message': dict(entry), 'reset': True}
        else:
            yield {'reset': True}
        for call in calls[:4]:
            name = call["function"]["name"]
            entry = {"id": call["id"], "name": name, "arguments": call["arguments"], "status": "running"}
            activity.append(entry)
            yield {"tool": dict(entry)}
            try:
                local_tools.validate(name, call["arguments"])
                if name not in local_tools.AUTO.get(permission_mode, set()):
                    if approvals is None:
                        raise PermissionError("User approval is required for this tool.")
                    decision = asyncio.get_running_loop().create_future()
                    approvals[call["id"]] = decision
                    entry["status"] = "awaiting_permission"
                    yield {"tool": dict(entry)}
                    yield {"approval": {"id": call["id"], "name": name, "arguments": call["arguments"], "project": project}}
                    try:
                        allowed = await decision
                    finally:
                        approvals.pop(call["id"], None)
                    if not allowed:
                        raise PermissionError("User denied this action. Do not retry it through another tool.")
                    entry["status"] = "running"
                    yield {"tool": dict(entry)}
                result = await local_tools.execute(name, call["arguments"], project)
                entry.update(status="done", result=result)
            except PermissionError as exc:
                result = {"error": str(exc)}
                entry.update(status="denied", result=result)
            except asyncio.CancelledError:
                entry.update(status="cancelled")
                raise
            except Exception as exc:
                result = {"error": str(exc)}
                entry.update(status="error", result=result)
            yield {"tool": dict(entry)}
            response = {"role": "tool", "tool_call_id": call["id"], "name": name, "content": json.dumps(result)}
            history.append(response)
            tool_history.append(response)
        if len(calls) > 4:
            raise RuntimeError("Too many tools requested in one turn.")
