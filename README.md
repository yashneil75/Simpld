# Simpld Desktop

Desktop chat app. React (Vite) frontend, Python (FastAPI + llama.cpp) backend,
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

This builds the frontend, freezes the Python backend, downloads the mainline
llama.cpp build b12633, and packages the app into `release/`.

- `Simpld-0.1.0-setup.exe` — installer (Start Menu shortcut, uninstaller)
- `Simpld-0.1.0-portable.exe` — single file, runs anywhere

Double-click either to open Simpld. The frozen backend and llama.cpp
runtime stop when the app quits. Launching again focuses the existing window.

The installer includes the llama.cpp runtime. Open **Settings → Models** to
download **Qwen 3.8 27B** (IQ3_XXS, 10.44 GB). You can also run this command.

```
python -m backend.download Kintsugi-27b
```

Simpld uses a 131,072-token (128K) context for text chat with Q4 KV caching.
Weights and chats live in
`%USERPROFILE%\.simpld` on Windows and `~/.simpld` on macOS and Linux. Existing
model files remain on disk when you upgrade.

## Dev

Install the Python dependencies with `python -m pip install -r backend/requirements.txt`.
Run `npm ci` and `npm --prefix frontend ci` to install the Node dependencies,
then run `npm run dev` to open Electron. Electron starts its Python sidecar. For inference in development,
put a `llama-server` (mainline b12633) on `PATH` or set
`SIMPLD_LLAMA_SERVER` to the executable path.

For browser-only development, run `npm run backend` and
`npm run frontend:dev` in separate terminals.

## API

- `GET /api/health`, `GET /api/models`, `POST /api/models/select`
- `GET /api/projects`, `POST /api/projects/open`, `POST /api/projects/delete`
- `GET /api/session`, `GET /api/history`, `GET /api/conversations`, `POST /api/conversations/new`
- `POST /api/conversations/{id}/open`, `DELETE /api/conversations/{id}`
- `GET /api/settings`, `PUT /api/settings/{key}`
- `POST /api/chat` (full JSON reply), `POST /api/chat/stream` (SSE tokens + `[DONE]`)

Electron provides the folder picker and update controls. The title bar uses
native window controls and a draggable header.

# TODO migrate to Atlassian Design System