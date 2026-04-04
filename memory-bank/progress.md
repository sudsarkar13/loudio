# Progress — Loudio

## What works
- Core desktop app boots and runtime bootstrap messaging is wired.
- File and microphone transcription flows are implemented.
- Microphone recording can auto-trigger transcription when stopped.
- Transcript area is now editable for manual correction.
- New finalized transcript chunks append below existing text (with one empty line separator).
- Live partial transcription preview appears during processing and clears on completion.
- Auto-copy now copies the full merged transcript draft when enabled.
- Menu infrastructure is implemented with actionable items and keyboard shortcuts.
- Window menu includes compact mode check toggle.
- Compact mode/general mode switching and anchor movement are implemented.
- TypeScript/web/desktop production builds are passing after latest changes.

## Recent milestones
1. Transcript-editability and persistence pass:
   - replaced read-only transcript rendering with editable `transcriptDraft` source-of-truth
   - preserved manual edits across subsequent transcription cycles
2. Incremental append behavior pass:
   - added `appendTranscriptText` merge logic
   - enforced block separation with `\n\n`
3. Live preview pass:
   - introduced `livePreviewTranscript` state from progress events
   - separated preview UI from finalized transcript draft
4. Auto-copy semantics pass:
   - updated file/mic completion flows so clipboard gets merged full transcript
5. Compact mode menu integration pass:
   - added Window → Compact Mode check item
6. Compact minimize hardening pass:
   - added explicit minimize helper (`minimizeDesktopAppWindow`)
   - routed Window → Minimize action to helper
   - enforced `setMinimizable(true)` in compact enter and general restore paths
7. Capabilities security pass:
   - added `core:window:allow-minimize`
   - added `core:window:allow-set-minimizable`
8. Build validation pass:
   - `yarn build` successful
   - `yarn tauri:build` successful (app + dmg bundle)

## Open items
- Run interactive runtime verification for compact-mode minimizing:
  - Cmd+M in compact mode
  - Window → Minimize in compact mode
  - restore-from-Dock behavior
  - compact/general state continuity after restore
- If compact minimize still fails at runtime, add Rust-side minimize fallback command and wire menu/UI to fallback path.
- Resolve lint tooling mismatch (`next lint` script currently failing due project-dir resolution issue).

## Known issues (latest)
- **Primary unresolved runtime check:** compact-mode minimize behavior remains unconfirmed in live interactive QA despite successful permission and API updates.
- Lint command is currently not usable in this environment (`Invalid project directory .../loudio/lint`), though builds are green.
