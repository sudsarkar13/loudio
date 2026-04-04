# Tech Context — Loudio

## Core stack
- Next.js (App Router) + React + TypeScript
- Tauri v2 (Rust backend + JS API)
- Whisper runtime options (whisper.cpp / Python Whisper)
- ffmpeg for audio conversion to WAV

## Repo conventions
- No `src/` folder for app code; app code under `app/`.
- Tauri config and Rust sources under `src-tauri/`.

## Important files
- `app/components/TranscriptionStudio.tsx` — primary UI workflow (editable transcript draft, live preview, append behavior, mic/file orchestration).
- `app/lib/tauri.ts` — frontend runtime/menu/command/window integration.
- `app/styles/globals.css` — live preview and shell UI styling.
- `src-tauri/src/main.rs` — runtime bootstrap, conversion, transcription commands.
- `src-tauri/capabilities/default.json` — Tauri v2 permission gating for window/dialog/clipboard/fs APIs.
- `src-tauri/tauri.conf.json` — app identity and bundle icon mapping.
- `src-tauri/Info.plist` — macOS permissions metadata.

## Packaging/branding notes
- Bundle icons configured in `tauri.conf.json`.
- Public logo available at `public/loudio-logo.png`.

## Validation workflow
- Web build: `yarn build`
- Desktop bundle build: `yarn tauri:build`
- Rust check (fast): `cargo check --manifest-path /Users/lexprotech/Documents/GitHub/loudio/src-tauri/Cargo.toml`
- TS check (optional explicit): `npx tsc --noEmit`

## Recent technical updates
- Added explicit minimize helper in Tauri bridge: `minimizeDesktopAppWindow()`.
- Added compact/general window minimizable state enforcement via `setMinimizable(true)`.
- Added required capability permissions:
  - `core:window:allow-minimize`
  - `core:window:allow-set-minimizable`

## Current caveats
- Lint script currently misbehaves in this environment (`next lint` resolving `.../loudio/lint` as project dir). Build/TS/Rust checks pass, but lint command needs tooling-script correction.
- Compact-mode minimize requires interactive runtime verification despite successful compile/build results.
