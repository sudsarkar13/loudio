# Active Context — Loudio

## Current focus
Implement CI/CD release automation so a manual `package.json` version bump on `main` automatically creates a GitHub release and then builds/attaches platform artifacts (`.dmg` for macOS and `.deb` for Ubuntu), while preserving existing product/runtime workstreams.

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

## Validation status
- Static/build validations are green.
- EULA-gated runtime setup behavior is implemented in frontend state/effect flow.
- CI workflow logic has been implemented for version-driven release creation and release-triggered artifact attachment (.deb + .dmg).
- Remaining runtime UX verification needed in interactive app session to confirm first-run package install messaging and completion flow.
- Existing compact/general macOS traffic-light restoration issue remains open.

## Immediate next checks
- Validate GitHub Actions end-to-end on an actual `main` push with a manual `package.json` version bump:
  - release workflow should create tag/release once
  - artifact workflow should attach `.deb` and `.dmg` to that release
- Validate whether decorations-only restoration is insufficient on macOS and requires a Rust-side native window operation (or a different Tauri API sequence) to rehydrate standard title bar controls.
- If needed, move restoration orchestration for macOS into `src-tauri/src/main.rs` with explicit platform-conditional handling.
- Re-test compact → general flow in live runtime after any Rust-side restore strategy.
