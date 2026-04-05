# Progress — Loudio

## What works
- Core desktop app boots and runtime bootstrap messaging is wired.
- File and microphone transcription flows are implemented.
- Microphone recording can auto-trigger transcription when stopped.
- Transcript area is editable for manual correction.
- New finalized transcript chunks append below existing text with one empty-line separator (`\n\n`).
- Live partial transcription preview appears during processing and clears on completion.
- Auto-copy now copies the full merged transcript draft when enabled.
- Menu infrastructure is implemented with actionable items and keyboard shortcuts.
- Window menu includes compact mode check toggle.
- Compact/general mode switching and anchor movement are implemented.
- TypeScript/web/desktop production builds were passing after latest feature pass.

## Recent milestones
1. Transcript-editability and persistence pass:
   - adopted editable `transcriptDraft` as source-of-truth
   - preserved manual edits across subsequent transcription cycles
2. Incremental append behavior pass:
   - added `appendTranscriptText` merge logic
   - enforced `\n\n` separation between finalized blocks
3. Live preview pass:
   - introduced `livePreviewTranscript` from progress events
   - separated preview UI from finalized transcript draft
4. Auto-copy semantics pass:
   - completion flows now copy merged full transcript
5. Compact mode menu integration pass:
   - added Window → Compact Mode check item
6. Compact minimize hardening pass:
   - added explicit minimize helper (`minimizeDesktopAppWindow`)
   - routed Window → Minimize action to helper
   - enforced `setMinimizable(true)` in compact enter and general restore paths
7. Capabilities security pass:
   - added `core:window:allow-minimize`
   - added `core:window:allow-set-minimizable`
8. Repository and pattern verification pass (current session):
   - `git status --short --branch` indicates clean branch state (`main...origin/main`)
   - code search confirms presence of latest compact/transcript implementation symbols

## Open items
- Run interactive runtime verification for compact-mode minimizing:
  - Cmd+M in compact mode
  - Window → Minimize in compact mode
  - restore-from-Dock behavior
  - compact/general state continuity after restore
- If compact minimize still fails at runtime, add Rust-side minimize fallback command and wire menu/UI to fallback path.
- Resolve lint tooling mismatch (`yarn lint`/`next lint` currently failing with invalid project-directory resolution to `.../loudio/lint`).

## Known issues (latest)
- **Primary unresolved runtime check:** compact-mode minimize behavior remains unconfirmed in live interactive QA despite successful permission and API updates.
- **Confirmed tooling issue:** lint command currently unusable in this environment due to incorrect project-directory resolution (`.../loudio/lint`).