# Active Context — Loudio

## Current focus
Implement EULA-gated runtime dependency bootstrap so macOS package detection/installation (ffmpeg / whisper runtime dependencies) starts only after user consent, while preserving existing compact/general window stabilization work.

## Recently completed work
- Reworked EULA/startup sequencing in `app/components/TranscriptionStudio.tsx` so runtime bootstrap no longer runs on initial mount before consent.
- Added explicit post-EULA bootstrap orchestration:
  - introduced `hasCompletedRuntimeSetup` guard state
  - bootstrap effect now runs only when `hasAcceptedEula === true`
  - status/progress now start from `Accept the EULA to continue` and transition to dependency prep after acceptance
- Updated EULA accept flow message to reflect installation workflow (`Preparing runtime dependencies…`).
- Preserved existing backend bootstrap behavior in `src-tauri/src/main.rs`, which already does detect/install attempts for:
  - `ffmpeg` (detect + Homebrew install fallback)
  - `whisper.cpp` (`whisper-cli`, Homebrew fallback)
  - Python Whisper runtime (system detection or app-local venv install)
- Validation checks completed:
  - `npm run -s tsc -- --noEmit --pretty false`
  - `cargo check --manifest-path /Users/lexprotech/Documents/GitHub/loudio/src-tauri/Cargo.toml`

## Validation status
- Static/build validations are green.
- EULA-gated runtime setup behavior is implemented in frontend state/effect flow.
- Remaining runtime UX verification needed in interactive app session to confirm first-run package install messaging and completion flow.
- Existing compact/general macOS traffic-light restoration issue remains open.

## Immediate next checks
- Validate whether decorations-only restoration is insufficient on macOS and requires a Rust-side native window operation (or a different Tauri API sequence) to rehydrate standard title bar controls.
- If needed, move restoration orchestration for macOS into `src-tauri/src/main.rs` with explicit platform-conditional handling.
- Re-test compact → general flow in live runtime after any Rust-side restore strategy.
