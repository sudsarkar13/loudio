# Active Context — Loudio

## Current focus

System Readiness as a **separate OS window**, plus the language work around it (transcribe vs translate) and the microphone reliability fixes. Readiness detects, verifies and — with explicit per-step consent — installs or updates the prerequisites Loudio needs. The OS installer remains the single legal surface (`bundle.licenseFile`); there is no in-app EULA gate.

## Recently completed work

- **System Readiness Wizard (v1) shipped:**
  - Rust module `src-tauri/src/system_readiness.rs` exposes `check_system_readiness`, `install_readiness_item`, `skip_readiness_item`, `reset_readiness_skips`, `read_full_license`, `readiness_manual_command`; streams `readiness-progress` events.
  - Items managed: `ffmpeg`, `whisper-cpp`, `python`, `openai-whisper`, `models-dir`. Per-OS install paths: macOS (Homebrew), Linux (apt + non-interactive sudo fallback), Windows (winget).
  - Frontend hook `useSystemReadinessWizard` drives the wizard state machine (`detecting → review → installing → verifying → ready/skipped/failed`) and persists a snapshot of installed versions for drift detection.
  - Readiness UI now lives in `components/readiness/`: `ReadinessWindow`, `ReadinessCheckCard`, `ReadinessStatusRing`, `ReadinessDriftBanner`, `summary.ts`.
  - Drift banner is rendered in the top strip; it surfaces when the cached snapshot diverges from current state and offers one-click re-review.
- **In-app EULA gate removed:**
  - Deleted `components/transcription-studio/components/EulaGate.tsx` and `hooks/useEulaAcceptance.ts`.
  - `TranscriptionStudio` now uses `useSystemReadinessWizard` in place of `useEulaAcceptance`. The `bundle.licenseFile` in `tauri.conf.json` continues to drive the OS-installer license dialog (legal acceptance remains a single, install-time surface).
  - New `AboutPanel` opened from the top strip shows the full MIT license text via the new Rust `read_full_license` command.
- **Readiness moved out of the main window (supersedes the overlay above):**
  - `src-tauri/src/readiness_window.rs` creates a `readiness`-labelled `WebviewWindow` on demand at route `readiness/`, with its own `src-tauri/capabilities/readiness.json`. Commands: `open_readiness_window`, `close_readiness_window`, `notify_readiness_changed`.
  - Cross-window sync is by event (`readiness://changed`, `readiness://closed`) with **no payload** — listeners re-run their own check rather than trusting a marshalled report.
  - The acknowledgement flag (`loudio:readiness:completed:v1`) is read from storage at the point of decision, never held in React state, because two windows would otherwise disagree.
  - `next.config.mjs` sets `trailingSlash: true` so `/readiness/` resolves identically in dev and in the static export. Tauri's asset fallback ends at `index.html`, so a wrong route would silently render the main studio inside the readiness window — pinned by a test.
  - Deleted `SystemReadinessWizard`, `ReadinessProgressBar`, `ReadinessCompleteScreen` (the overlay and its exclusive children).
- **Microphone grant is remembered across launches:**
  - WebKit exposes no existing OS grant to the page (permission query unimplemented; device labels empty until capture succeeds in that session), so both signals read as denied on every cold start. `loudio:mic:granted:v1` records the grant and a silent re-prime restores device labels. Only `NotAllowedError`/`SecurityError` clear it.
- **Builds validated:**
  - `yarn build` — clean
  - `cargo check --manifest-path src-tauri/Cargo.toml` — clean (0 warnings)
  - `yarn tauri:build` — produces `Loudio.app` and `Loudio_1.0.4_aarch64.dmg` with zero compiler warnings (fixed `use tauri::Manager` unused import on macOS)

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
