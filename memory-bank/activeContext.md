# Active Context — Loudio

## Current focus
Finalize runtime QA for compact-mode minimizing behavior on macOS (Cmd+M and Window → Minimize), while preserving the completed transcript-editing + append workflow and keeping release build stability.

## Recently completed work
- Transcript UX refactor is in place across the studio flow:
  - editable transcript source-of-truth via `transcriptDraft`
  - separate temporary partial state via `livePreviewTranscript`
  - finalized segment merging through `appendTranscriptText(...)` with `\n\n` separation
  - auto-copy behavior now copies merged full transcript draft
- Desktop window/menu integration updates are implemented in `app/lib/tauri.ts`:
  - Window menu compact mode check item (`window_toggle_compact_mode`)
  - minimize action routed through shared helper (`minimizeDesktopAppWindow()`)
  - compact/general transitions enforce `setMinimizable(true)`
- Capability permissions were added in `src-tauri/capabilities/default.json`:
  - `core:window:allow-minimize`
  - `core:window:allow-set-minimizable`
- Build validation already succeeded in prior pass:
  - `yarn build`
  - `yarn tauri:build`

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