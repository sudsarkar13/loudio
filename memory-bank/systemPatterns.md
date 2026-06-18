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
   - Once promoted, retranscription runs through the same file transcription path.

5. **Auto-copy semantics bound to merged output**
   - Auto-copy executes after finalized result merge.
   - Clipboard content equals full merged draft, not only latest segment.

6. **Desktop menu composition + compact-mode controls**
   - Menu built via Tauri API with File/Edit/View/Window/Help.
   - Window submenu includes compact-mode check item bound to current state (`window_toggle_compact_mode`).
   - Minimize action routes through explicit helper (`minimizeDesktopAppWindow`) for consistency.

7. **Capability-gated window operations**
   - Window behaviors require explicit Tauri capability permissions.
   - Compact-mode minimize hardening depends on:
     - `core:window:allow-minimize`
     - `core:window:allow-set-minimizable`

8. **First-run readiness wizard (premium onboarding)**
   - Legal acceptance is a single install-time surface (`bundle.licenseFile` in `tauri.conf.json`); in-app `EulaGate` is intentionally absent.
   - On first launch the wizard runs `check_system_readiness` which emits one `ReadinessCheck` per prerequisite (ffmpeg, whisper-cpp, python, openai-whisper, models-dir) with state, action kind, severity, and a manual command.
   - Each prerequisite is its own card with `Install / Reinstall / Update / Skip` and a copyable manual command; nothing is auto-installed without an explicit click.
   - Per-step install progress is streamed via the `readiness-progress` event; failures surface in the same UI and the user can fall back to the manual command shown in the card.
   - On every subsequent launch a fast health check re-uses the cached snapshot and surfaces a `ReadinessDriftBanner` whenever any prerequisite state has changed (e.g. an update appeared, or the user installed something externally).
   - Snapshot and per-item skip decisions are persisted at `$APPDATA/com.loudio.desktop/readiness/{snapshot,skipped}.json` (with the source of truth on the Rust side; mirrored to localStorage only for first-paint).

9. **About panel as in-app license surface**
   - `AboutPanel` is opened from the top strip and renders the bundled `LICENSE` via the `read_full_license` Rust command (`include_str!("../../LICENSE")`). This satisfies the "license must be visible from inside the app" expectation without re-prompting the user.
     - `core:window:allow-set-minimizable`

10. **Validation pattern split: compile/build vs runtime UX checks**
    - Static confidence is established through build/type/Rust checks and symbol-level verification.
    - Desktop window-behavior confidence still requires interactive runtime QA, especially for macOS compact-mode minimize/restore behavior.

## Current design tension

Cross-platform declarative window styling and compact-shell UX are stable at build-time, but macOS runtime behavior around minimize/titlebar affordances can diverge. The prevailing mitigation is explicit capability + explicit window API sequencing, with a Rust-side fallback if JS-side control remains insufficient.
