# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase, two surfaces: (1) the desktop app — Electron + React (Vite) frontend, Python FastAPI + llama.cpp backend; (2) the public site — static HTML/CSS in `docs/` (GitHub Pages). The work below is on the static site; stack per user-approved plan confirmed 2026-11-07.

## Users

Developers and GPU-owning hobbyists (gamers, tinkerers, AI-curious people) who want a capable AI assistant running locally on their own machine, with no account, no cloud, and no data leaving the device. They arrive at the site via the GitHub repo or word of mouth, usually already deciding whether to try it.

## Product Purpose

Simpld is a free, open-source desktop chat app for Windows, macOS and Linux. Pick a model from a built-in library, Simpld loads it onto your GPU, and answers happen inside one window — ancestry app "Simply" included. Success = someone who arrived curious leaves with the right installer for their hardware downloaded.

## Positioning

Runs entirely on your own GPU, in one window, offline: no server does the thinking, the model lives on your disk, and the internet can be switched off entirely. A cloud chat product cannot copy "your data never leaves your machine and it still works when the router dies."

## Operating Context

The public site is the download + introduction surface for GitHub-hosted releases (Simpld-windows-cuda.exe / -vulkan.exe, Simpld-macos-metal.dmg, Simpld-linux-{cuda,vulkan}.AppImage). Model weights are not bundled (GBs) — the app downloads them per machine to `%USERPROFILE%\.simpld`. OS gatekeepers warn on unsigned builds; the site must carry the SmartScreen/right-click-open instructions. Single-person open-source project.

## Capabilities and Constraints

- Backend accelerations: CUDA, Vulkan, Metal (explicitly supported combos per platform; macOS = Apple Silicon only for now, Intel Macs not supported)
- Mock model is the on-disk default until real weights are downloaded and the app restarts
- Licensing: free forever, open source
- The site is plain static HTML/CSS with no build step and no dependencies; keep it that way
- `about.html` was removed at user request (2026-11-07); no page may link to it

## Brand Commitments

- Name: Simpld (app) / Simply (in-app assistant). Both are pinned
- Logo: `Logo.png` at repo root; ★ symbol appears in the site wordmark
- Voice (confirmed by existing site copy): plain, warm, a little wry — "If it has drivers, it runs." No hype, no invented claims
- Hanken Grotesk ships inside the desktop app (`frontend/src/assets/fonts/hanken-grotesk-variable.ttf`); continuity between app and site is confirmed as binding

## Evidence on Hand

README.md, existing download links (GitHub releases, verbatim), Logo.png, in-app fonts, working desktop screenshots do not exist yet — nothing photographic of the app UI may be fabricated without labeling it synthetic.

## Product Principles

- Privacy is the product: everything said here must be true of the whole surface
- Honest about hardware: match a build to what the visitor actually owns, say when their GPU isn't supported yet
- Free means free: costs, accounts, telemetry — none of it exists, never imply otherwise
- The site and the app should feel like the same object in two places

## Accessibility & Inclusion

No formal standard named. Provide keyboard focus visibility, semantic HTML, contrast-safe text over the ASCII hero, reduced-motion off-ramp for the canvas animation, and an alt/canvas-off equivalent for the ASCII background.
