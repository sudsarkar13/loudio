# Active Context — Loudio

## Current focus

Premium first-run experience: replace the in-app EULA gate with a System Readiness Wizard that detects, verifies, and (with explicit per-step consent) installs/updates the prerequisites Loudio needs to run. The OS installer keeps presenting the MIT license (single legal surface); the in-app gate is removed in favour of an `AboutPanel`.

## Recently completed work

- **System Readiness Wizard (v1) shipped:**
  - Rust module `src-tauri/src/system_readiness.rs` exposes `check_system_readiness`, `install_readiness_item`, `skip_readiness_item`, `reset_readiness_skips`, `read_full_license`, `readiness_manual_command`; streams `readiness-progress` events.
  - Items managed: `ffmpeg`, `whisper-cpp`, `python`, `openai-whisper`, `models-dir`. Per-OS install paths: macOS (Homebrew), Linux (apt + non-interactive sudo fallback), Windows (winget).
  - Frontend hook `useSystemReadinessWizard` drives the wizard state machine (`detecting → review → installing → verifying → ready/skipped/failed`) and persists a snapshot of installed versions for drift detection.
  - New `SystemReadinessWizard` plus `ReadinessCheckCard`, `ReadinessProgressBar`, `ReadinessCompleteScreen`, `ReadinessDriftBanner` components.
  - Drift banner is rendered in the top strip; it surfaces when the cached snapshot diverges from current state and offers one-click re-review.
- **In-app EULA gate removed:**
  - Deleted `components/transcription-studio/components/EulaGate.tsx` and `hooks/useEulaAcceptance.ts`.
  - `TranscriptionStudio` now uses `useSystemReadinessWizard` in place of `useEulaAcceptance`. The `bundle.licenseFile` in `tauri.conf.json` continues to drive the OS-installer license dialog (legal acceptance remains a single, install-time surface).
  - New `AboutPanel` opened from the top strip shows the full MIT license text via the new Rust `read_full_license` command.
- **Builds validated:**
  - `yarn build` — clean
  - `yarn tauri:build` — produces `Loudio.app` and `Loudio_0.1.0_aarch64.dmg`

## Validation status

- Repository currently appears clean and on `main` tracking `origin/main`.
- Pattern checks confirm the expected symbols and code paths exist (`minimizeDesktopAppWindow`, `setMinimizable(true)`, compact menu item, live preview and append utilities).
- Lint command issue is confirmed in current environment:
  - `yarn lint` returns: `Invalid project directory provided, no such directory: .../loudio/lint`
- Remaining gap is interactive runtime confirmation of compact-mode minimize/restore behavior.

## Immediate next checks

1. Launch app in Tauri runtime and switch to compact mode.
2. Verify `Cmd+M` minimizes window in compact mode.
3. Verify Window → Minimize also works in compact mode.
4. Restore from Dock and verify:
   - transcript state is preserved
   - compact/general toggle state remains coherent
5. If minimize still fails in runtime, implement Rust-command fallback for minimize and retest.

## Current caveats

- Lint script/tooling mismatch remains unresolved and should be corrected separately from compact-mode runtime QA.
