# System Patterns — Loudio

## Architecture
- **Frontend:** Next.js App Router UI in `app/`.
- **Desktop shell/backend:** Tauri v2 + Rust in `src-tauri/`.
- **Transcription flow:** frontend invokes Rust commands; Rust handles runtime checks, conversion, and transcription.

## Key implementation patterns
1. **Runtime command bridge**
   - Frontend uses `invoke` wrappers in `app/lib/tauri.ts`.
   - Typed request/response contracts through shared TS types.

2. **Event-driven progress updates**
   - Rust emits runtime/transcription progress events.
   - Frontend subscribes and updates status/live transcript.

3. **Mic capture fallback strategy**
   - Primary: `MediaRecorder` with supported mime type.
   - Fallback: `AudioContext` + WAV encoding.
   - Blob sent base64 to backend for conversion/transcription.

4. **Unified transcription entry path for file + mic history**
   - Fresh mic recordings may auto-transcribe immediately through the microphone command path.
   - Persisted mic recordings in History can be promoted into `audioPath` via a `Use` action.
   - Once promoted, retranscription runs through the same `onTranscribe` / `transcribe_audio` file flow as uploaded files.
   - This keeps runtime/model/language/task setting behavior consistent across both uploaded and microphone-originated files.

5. **Audio conversion robustness**
   - Backend detects ffmpeg path (PATH/env/common locations).
   - Non-WAV mic inputs are normalized to WAV before transcription.

6. **Desktop menu composition**
   - Menu built via Tauri API with File/Edit/View/Window/Help.
   - View toggles use `CheckMenuItem` for proper checked state.
   - Help uses predefined native About metadata.

## Current design tension
Balancing cross-platform web-like rendering constraints with native desktop expectations. Menu/About behavior is intentionally moved toward OS-native primitives whenever feasible.
