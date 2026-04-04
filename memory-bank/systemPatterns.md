# System Patterns — Loudio

## Architecture
- **Frontend:** Next.js App Router UI in `app/`.
- **Desktop shell/backend:** Tauri v2 + Rust in `src-tauri/`.
- **Transcription flow:** frontend invokes Rust commands; Rust handles runtime checks, conversion, and transcription.

## Key implementation patterns
1. **Runtime command bridge**
   - Frontend uses `invoke` wrappers in `app/lib/tauri.ts`.
   - Typed request/response contracts through shared TS types.

2. **Event-driven progress updates with split transcript states**
   - Rust emits runtime/transcription progress events.
   - Frontend separates temporary partial output (`livePreviewTranscript`) from persisted editable output (`transcriptDraft`).
   - On completion, normalized final text is appended into draft and preview is cleared.

3. **Editable-append transcript model**
   - `transcriptDraft` is user-editable and retained across additional transcriptions.
   - `appendTranscriptText(existing, next)` normalizes and appends with `\n\n` spacing.
   - This preserves prior manual edits and merges new finalized text predictably.

4. **Unified transcription entry path for file + mic history**
   - Fresh mic recordings may auto-transcribe immediately through microphone command path.
   - Persisted mic recordings in History can be promoted into `audioPath` via `Use`.
   - Once promoted, retranscription runs through the same `onTranscribe` / `transcribe_audio` file flow as uploaded files.

5. **Auto-copy semantics bound to merged output**
   - Auto-copy executes after finalized result merge.
   - Clipboard content equals full merged draft, not only latest segment.

6. **Desktop menu composition + compact-mode controls**
   - Menu built via Tauri API with File/Edit/View/Window/Help.
   - Window submenu includes compact-mode check item bound to current state.
   - Minimize action routes through explicit helper (`minimizeDesktopAppWindow`) for consistency.

7. **Capability-gated window operations**
   - Window behaviors require explicit Tauri capability permissions.
   - Compact-mode minimize hardening depends on:
     - `core:window:allow-minimize`
     - `core:window:allow-set-minimizable`

## Current design tension
Cross-platform declarative window styling and compact-shell UX are stable at build-time, but macOS runtime behavior around minimize/titlebar affordances can diverge. The prevailing mitigation is explicit capability + explicit window API sequencing, with a Rust-side fallback if JS-side control remains insufficient.
