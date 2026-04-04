# Product Context — Loudio

## Why this project exists
Loudio exists to provide a dependable local/offline transcription workflow for desktop users, especially on macOS/Apple Silicon, without requiring cloud upload of sensitive audio.

## Problems it solves
- Friction in converting interviews/meetings/voice notes into text quickly.
- Reliability gaps in microphone capture, conversion, and iterative transcription workflows.
- Need for desktop-native controls (menu actions, shortcuts, About behavior, compact-window behavior).

## Target user experience
- Open app, pick file or record mic, and get transcript with minimal steps.
- Edit transcript text directly in-place when transcription mistakes occur.
- Keep previously corrected transcript content while appending newly finalized transcription blocks below it.
- See temporary live partial output during transcription, then finalized text merged into the editable transcript.
- Use practical output controls: copy, clear, auto-copy, timestamps.
- Feel native desktop polish through menu behavior, compact mode, and proper packaged identity/icons.

## Current UX decisions
- Microphone recording auto-triggers transcription when recording stops.
- Transcript area is editable and acts as the durable draft source-of-truth.
- New finalized transcript segments append with an empty line separator (`\n\n`).
- Auto-copy copies the full merged transcript draft, not only the latest segment.
- Live preview is shown separately while transcription is in progress and cleared on completion.
- Compact mode can be toggled from both UI and Window menu; minimize behavior is being hardened for compact mode reliability.
- About is shown using native app-menu About behavior (not an in-app modal).
