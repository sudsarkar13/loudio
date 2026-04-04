# Active Context — Loudio

## Current focus
Stabilize the transcription UX so the primary **Transcribe** action works consistently across both uploaded files and previously recorded microphone audio, including re-transcription with changed runtime/model settings.

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
- Added release automation workflows under `.github/workflows/`:
  - `create-release-on-version-bump.yml`: triggers on push to `main` when `package.json` changes, compares previous/current version, creates `v<version>` tag + GitHub release only when version changed and tag is absent.
  - `release-artifacts.yml`: triggered by successful completion of the release-creation workflow, resolves release context from commit/tag, then builds and attaches:
    - Ubuntu `.deb` on `ubuntu-latest`
    - macOS `.dmg` on `macos-latest`
- Converted `ubuntu-deb.yml` to a manual-only fallback workflow (`workflow_dispatch`) to avoid duplicate release uploads.
- Implemented microphone recording reuse from history in `app/components/TranscriptionStudio.tsx`:
  - added `onUseRecordingForTranscription(item)` to promote a history recording into the active file source (`audioPath`)
  - clears temporary mic blob state when a persisted history item is selected, so the pipeline is unambiguous
  - switches view from History → Activity after selection to keep the action flow immediate
  - provides status messaging so users can change settings (runtime/model/task/language) and re-run **Transcribe** on the selected mic file
- Added a `Use` action button per recording row in history so microphone captures can be reprocessed via the same `onTranscribe` file path used for uploaded audio.
- Validation checks completed after the update:
  - `npm run -s tsc -- --noEmit --pretty false`
  - `cargo check --manifest-path /Users/lexprotech/Documents/GitHub/loudio/src-tauri/Cargo.toml`

## Validation status
- Static/build validations are green.
- EULA-gated runtime setup behavior is implemented in frontend state/effect flow.
- CI workflow logic has been implemented for version-driven release creation and release-triggered artifact attachment (.deb + .dmg).
- Remaining runtime UX verification needed in interactive app session to confirm first-run package install messaging and completion flow.
- Existing compact/general macOS traffic-light restoration issue remains open.
- Mic recording history now supports selecting a recorded file for retranscription through the standard file-based Transcribe action.

## Immediate next checks
- Interactive QA pass for mic retranscription UX:
  - record mic audio
  - open History
  - click `Use`
  - change model/runtime settings (small/medium/large or profile change)
  - run Transcribe and verify result/modelUsed metadata updates correctly
- Validate no regressions in existing flows:
  - direct uploaded-file transcription
  - auto-transcribe after mic stop
  - recording playback/delete operations in history
- Validate GitHub Actions end-to-end on an actual `main` push with a manual `package.json` version bump:
  - release workflow should create tag/release once
  - artifact workflow should attach `.deb` and `.dmg` to that release
- Validate whether decorations-only restoration is insufficient on macOS and requires a Rust-side native window operation (or a different Tauri API sequence) to rehydrate standard title bar controls.
- If needed, move restoration orchestration for macOS into `src-tauri/src/main.rs` with explicit platform-conditional handling.
- Re-test compact → general flow in live runtime after any Rust-side restore strategy.
