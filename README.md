# Simpld Desktop

Desktop chat app. React (Vite) frontend, Python (FastAPI + llama-cpp-python) backend,
Electron frameless shell.

```
Simpld-Desktop/
  backend/          Python API: app.py (FastAPI), config.py, store.py,
                    model.py, download.py, requirements.txt
    test_store.py   SQLite store tests (15 tests)
  backend_main.py   PyInstaller entry point (freezes backend/ to an exe)
  frontend/         React + Vite app (src/, public/fonts/, dist/ after build)
  electron/         main.cjs (window + backend sidecar), preload.cjs (bridge)
  dist-backend/     Frozen backend (build artifact, not in git)
  release/          Installer + portable exe (build artifact, not in git)
```

## The desktop app (installer / portable exe)

```
npm run dist
```

This builds the frontend, freezes the Python backend together with the installed
`llama_cpp` package and its native libraries, and packages the app into `release/`.
Install the GPU build of `llama-cpp-python` for your platform before building
(see Dev below). Release builds use CUDA or Vulkan wheels and build Metal from
source. CUDA releases include the matching runtime and cuBLAS redistributables.

- `Simpld-0.1.0-setup.exe` — installer (Start Menu shortcut, uninstaller)
- `Simpld-0.1.0-portable.exe` — single file, runs anywhere

Double-click either to open Simpld. The model runs inside the frozen Python
backend and stops when the app quits. Launching again focuses the existing window.

The installer includes `llama-cpp-python`. Open **Settings → Models** to
download **Qwen 3.8 27B** (IQ3_XXS, 10.44 GB). You can also run this command.

```
python -m backend.download Kintsugi-27b
```

Simpld uses a 128K context for text chat with Q4 KV caching.
Reasoning streams into the **Show thinking** dropdown and is saved with the reply.
The **Reasoning** selector beside the model offers Low, Medium, and Extra high
and remembers your choice. It passes the model's native `reasoning_effort`
(`low`, `medium`, `xhigh`) into the GGUF's own chat template. See the
[official model documentation](https://huggingface.co/Qwen/Qwen3.8-27B).
Weights and chats live in
`%USERPROFILE%\.simpld` on Windows and `~/.simpld` on macOS and Linux. Existing
model files remain on disk when you upgrade.

## Dev

Use Python 3.11. Install Python dependencies with the GPU wheel index for your hardware:

```powershell
# Windows or Linux: Vulkan (AMD, Intel, or NVIDIA)
python -m pip install --only-binary=llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/vulkan -r backend/requirements.txt

# Windows or Linux: NVIDIA CUDA 12.4
python -m pip install --only-binary=llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124 -r backend/requirements.txt
python -m pip install -r backend/requirements-cuda.txt
python scripts/prepare-cuda-runtime.py

```

On Apple Silicon, build Metal from source to avoid the upstream 0.3.36 wheel's
invalid ZIP checksums (requires Xcode command line tools):

```sh
CMAKE_ARGS="-DGGML_METAL=ON -DGGML_NATIVE=OFF" python -m pip install --no-binary=llama-cpp-python -r backend/requirements.txt
```

If replacing an existing CPU build, add `--force-reinstall --no-cache-dir`.
For CPU-only development, use `python -m pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu -r backend/requirements.txt`.
The [upstream installation guide](https://github.com/abetlen/llama-cpp-python#installation)
also covers compiling from source. Install `pyinstaller` to build the desktop bundle.

Run `npm ci` and `npm --prefix frontend ci` to install the Node dependencies,
then run `npm run dev` to open Electron. Electron starts its Python sidecar.
Inference loads the GGUF directly through `llama_cpp.Llama`, with GPU offload,
flash attention, and Q4 KV caching on a dedicated worker thread.

For browser-only development, run `npm run backend` and
`npm run frontend:dev` in separate terminals.

## API

Chat can call `search_web` (DDGS search) and `web_fetch` (public webpage text).
Tool definitions go through the model's native chat template; calls are parsed
using Qwen Coder XML (`tool_call`, `function=`, `parameter=`). No additional
call-format prompt is injected. Results feed back into generation, and the
collapsible web activity list is saved with the assistant's reply. Each turn
allows up to eight tool rounds, with four calls per round.

- `GET /api/health`, `GET /api/models`, `POST /api/models/select`
- `GET /api/projects`, `POST /api/projects/open`, `POST /api/projects/delete`
- `GET /api/session`, `GET /api/history`, `GET /api/conversations`, `POST /api/conversations/new`
- `POST /api/conversations/{id}/open`, `DELETE /api/conversations/{id}`
- `GET /api/settings`, `PUT /api/settings/{key}`
- `POST /api/chat` (full JSON reply), `POST /api/chat/stream` (SSE tokens + `[DONE]`)

Electron provides the folder picker and update controls. The title bar uses
native window controls and a draggable header.

# TODO migrate to Atlassian Design System
