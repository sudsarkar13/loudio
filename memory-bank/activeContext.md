# Active Context — Loudio

## Current focus
Close the compact-mode window-management reliability gap on macOS (Cmd+M / Window → Minimize), while preserving the newly completed transcript-editing and append UX.

## Recently completed work
- Completed transcript UX refactor in `app/components/TranscriptionStudio.tsx`:
  - transcript display is now editable via textarea (`transcriptDraft`).
  - introduced separate live partial state (`livePreviewTranscript`).
  - finalized transcription appends into existing draft using `appendTranscriptText(...)`.
  - append separator updated to one blank line (`\n\n`) between blocks.
  - auto-copy now copies the merged full transcript draft.
  - clear/copy actions now operate on editable draft.
- Added live preview styling in `app/styles/globals.css` (`.transcript-live-preview`, label/text classes).
- Updated desktop menu integration in `app/lib/tauri.ts`:
  - added Window menu compact-mode check item (`window_toggle_compact_mode`).
  - replaced inline minimize action with shared `minimizeDesktopAppWindow()` helper.
- Hardened compact/general window transitions in `app/lib/tauri.ts`:
  - `setMinimizable(true)` now applied entering compact mode and restoring general mode.
- Updated Tauri capability permissions in `src-tauri/capabilities/default.json`:
  - added `core:window:allow-minimize`
  - added `core:window:allow-set-minimizable`
- Build validation completed successfully:
  - `yarn build`
  - `yarn tauri:build` (generated app + dmg bundles)

## Validation status
- TypeScript/build pipelines are green for the updated code path.
- Capability-related runtime error for minimize permission was addressed by permission updates.
- Final interactive runtime confirmation is still pending for:
  - Cmd+M minimizing in compact mode
  - Window → Minimize in compact mode
  - correct restore-from-Dock behavior and compact toggle state continuity

## Immediate next checks
1. Launch app in Tauri runtime and enter compact mode.
2. Verify `Cmd+M` minimizes the compact window.
3. Verify Window menu `Minimize` also works in compact mode.
4. Restore app from Dock and confirm:
   - transcript state is intact
   - compact/general toggle state remains coherent
5. If minimize still fails, implement Rust-command fallback for minimize invocation and re-test.

## Current caveat
- `next lint` via existing script (`next lint`) currently resolves incorrectly in this environment (`Invalid project directory .../loudio/lint`), indicating a lint-script/tooling mismatch that should be corrected separately.
