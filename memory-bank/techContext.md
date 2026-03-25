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
- `app/components/TranscriptionStudio.tsx` — primary UI workflow.
- `app/lib/tauri.ts` — frontend runtime/menu/command integration.
- `src-tauri/src/main.rs` — runtime bootstrap, conversion, transcription commands.
- `src-tauri/tauri.conf.json` — app identity and bundle icon mapping.
- `src-tauri/Info.plist` — macOS permissions metadata.

## Packaging/branding notes
- Bundle icons configured in `tauri.conf.json`.
- Public logo available at `public/loudio-logo.png`.

## Validation workflow
- TypeScript check: `npx tsc --noEmit`
- Rust check: `cargo check --manifest-path /Users/lexprotech/Documents/GitHub/loudio/src-tauri/Cargo.toml`

## Recent technical caveat
- Native About icon metadata requires an image object/bytes; passing plain file path caused runtime error (`expected RGBA image data, found a file path`).
