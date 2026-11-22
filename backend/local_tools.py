"""Local tools. Authorization is enforced by tool_chat before execution."""
import asyncio
import os
from pathlib import Path

from backend import web_tools


def schema(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": {key: {"type": "string", "description": value} for key, value in properties.items()},
                           "required": required, "additionalProperties": False}}}


TOOLS = web_tools.TOOLS + [
    schema("read_file", "Read a UTF-8 file. Relative paths use the current project.", {"path": "File path"}, ["path"]),
    schema("write_file", "Create or replace a UTF-8 file. Creates parent directories.", {"path": "File path", "content": "Complete file content"}, ["path", "content"]),
    schema("edit_file", "Replace one exact occurrence of old_text in a UTF-8 file. Fails if the match is missing or ambiguous.", {"path": "File path", "old_text": "Exact text to replace", "new_text": "Replacement text"}, ["path", "old_text", "new_text"]),
    schema("shell", "Run a shell command in the current project (PowerShell on Windows). Commands time out after 60 seconds.", {"command": "Command to execute"}, ["command"]),
]
NAMES = {tool["function"]["name"] for tool in TOOLS}
AUTO = {
    "read_only": {"read_file", "search_web", "web_fetch"},
    "accept_edits": {"read_file", "search_web", "web_fetch", "write_file", "edit_file"},
    "allow_all": NAMES,
}


def file_path(arguments, project):
    raw = arguments.get("path")
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("Provide a file path.")
    path = Path(raw).expanduser()
    return (Path(project) / path).resolve() if not path.is_absolute() else path.resolve()


def validate(name, arguments):
    if name not in NAMES:
        raise ValueError(f"Unknown tool: {name}")
    spec = next(tool["function"]["parameters"] for tool in TOOLS if tool["function"]["name"] == name)
    if not isinstance(arguments, dict) or set(arguments) - set(spec["properties"]):
        raise ValueError("Invalid tool arguments.")
    if any(key not in arguments for key in spec["required"]) or any(not isinstance(value, str) for value in arguments.values()):
        raise ValueError("Required tool arguments must be strings.")
    if sum(len(value) for value in arguments.values()) > 1_000_000:
        raise ValueError("Tool arguments exceed 1 MB.")


def execute_file(name, arguments, project):
    path = file_path(arguments, project)
    if name in {"read_file", "edit_file"}:
        with path.open("r", encoding="utf-8", newline="") as handle:
            content = handle.read(1_000_001)
        if len(content) > 1_000_000:
            raise ValueError("File exceeds the 1 MB limit.")
    if name == "read_file":
        return {"path": str(path), "content": content[:60000], "truncated": len(content) > 60000}
    if name == "edit_file":
        old = arguments["old_text"]
        if not old or content.count(old) != 1:
            raise ValueError("old_text must match exactly once. Read the file and retry.")
        content = content.replace(old, arguments["new_text"], 1)
    else:
        content = arguments["content"]
        path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(content)
    return {"path": str(path), "characters_written": len(content)}


async def execute(name, arguments, project):
    if name in {"search_web", "web_fetch"}:
        return await asyncio.wait_for(asyncio.to_thread(web_tools.execute, name, arguments), 30)
    if name != "shell":
        return await asyncio.to_thread(execute_file, name, arguments, project)
    if not arguments["command"].strip():
        raise ValueError("Provide a command.")
    command = (["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", arguments["command"]]
               if os.name == "nt" else ["/bin/sh", "-c", arguments["command"]])
    process = await asyncio.create_subprocess_exec(*command, cwd=project, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT,
                                                **({"creationflags": 0x08000000} if os.name == "nt" else {"start_new_session": True}))
    output = bytearray()
    async def collect():
        while chunk := await process.stdout.read(8192):
            if len(output) < 60000:
                output.extend(chunk[:60000 - len(output)])
        await process.wait()
    try:
        await asyncio.wait_for(collect(), 60)
    finally:
        if process.returncode is None:
            if os.name == "nt":
                killer = await asyncio.create_subprocess_exec("taskkill", "/PID", str(process.pid), "/T", "/F", stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, creationflags=0x08000000)
                await killer.wait()
            else:
                import signal
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
    return {"exit_code": process.returncode, "output": output.decode("utf-8", errors="replace"), "truncated": len(output) >= 60000}
