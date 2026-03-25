# Product Context — Loudio

## Why this project exists
Loudio exists to provide a dependable local/offline transcription workflow for desktop users, especially on macOS/Apple Silicon, without requiring cloud upload of sensitive audio.

## Problems it solves
- Friction in converting interviews/meetings/voice notes into text quickly.
- Reliability gaps in microphone capture and conversion pipelines during release usage.
- Need for desktop-native controls (menu actions, shortcuts, About behavior, app branding).

## Target user experience
- Open app, pick file or record mic, and get transcript with minimal steps.
- See clear runtime/status feedback when dependencies are checked or bootstrapped.
- Use practical editing output controls: copy, clear, auto-copy, timestamps.
- Feel native desktop polish through menu behavior and proper packaged identity/icons.

## Current UX decisions
- Microphone recording auto-triggers transcription when recording stops.
- Transcript text is normalized to avoid fragmented newline output.
- Export TXT button removed to keep workflow focused.
- Clear action is available in workspace and app menu.
- About is intended to be shown using native app-menu About behavior (not an in-app modal).
