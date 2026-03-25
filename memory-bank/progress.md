# Progress — Loudio

## What works
- Core desktop app boots and runtime bootstrap messaging is wired.
- File transcription and mic transcription flows are implemented.
- Mic recording can auto-trigger transcription when stopped.
- Transcript copy/clear workflows are available.
- Menu infrastructure is implemented with actionable items and keyboard shortcuts.
- Main studio interface has been redesigned into a compact, cleaner, icon-forward workflow with reduced text noise.
- Compact mode can be toggled on/off and restores the general window **to center** when exiting compact mode.
- Compact mode restore button label now matches product wording: **General**.
- TypeScript and Tauri production build checks are passing after the latest window-mode updates.

## Recent milestones
1. Fixed microphone conversion pipeline diagnostics around ffmpeg.
2. Added UX improvements (auto-transcribe, transcript normalization, clear action).
3. Introduced app menu architecture and packaging icon wiring.
4. Transitioned About experience toward native menu About behavior.
5. Completed first UI revamp pass.
6. Completed second UX-directed refinement pass focused on crispness and lower visual clutter:
   - removed heavy top marketing copy
   - converted toolbar to icon-first actions with hover tooltips
   - tightened spacing and contrast for a more professional desktop look
   - moved advanced settings into collapsible section.
7. Completed layout polish pass for density and scaling behavior:
   - fixed vertical spacing rhythm in settings controls (Task, Auto copy, Timestamps, Advanced)
   - reduced excessive shell/container padding
   - improved fill behavior so UI better occupies small and large window sizes with less dead space.
8. Finalized viewport-fit refinement for compact windows:
   - set `.loudio-shell` to `min-height: 100dvh` with flex column layout
   - made `.studio-layout` flex-fill (`flex: 1`) with `min-height: 0`
   - enforced min-height constraints on workspace/settings containers to eliminate bottom slack
   - preserved responsive single-column fallback for narrow breakpoints.
9. Compact/general mode stabilization pass:
   - changed compact restore button text from `Full` to `General`
   - confirmed Tauri v2 title bar style values are lowercase (`visible | transparent | overlay`)
   - updated macOS restore sequence in `app/lib/tauri.ts` to use `setTitleBarStyle("visible")` and staged decoration/resizable/show/focus re-application with small waits on macOS
10. EULA-gated runtime dependency bootstrap pass:
   - moved runtime bootstrap trigger to post-EULA acceptance path in `TranscriptionStudio.tsx`
   - added one-time guard (`hasCompletedRuntimeSetup`) to prevent duplicate bootstrap runs
   - aligned startup messaging with consent-first flow (`Accept the EULA to continue` → `Preparing runtime dependencies…`)
   - confirmed compile checks pass:
     - `npm run -s tsc -- --noEmit --pretty false`
     - `cargo check --manifest-path /Users/lexprotech/Documents/GitHub/loudio/src-tauri/Cargo.toml`
11. CI/CD release automation pass (latest):
   - added `.github/workflows/create-release-on-version-bump.yml`
     - trigger: push to `main` where `package.json` changed
     - behavior: read current + previous version, only proceed on version change
     - idempotency: skip when tag already exists
     - output: create `v<version>` tag and GitHub Release
   - added `.github/workflows/release-artifacts.yml`
     - trigger: successful completion of release-creation workflow
     - resolves release context from commit/tag
     - builds and attaches Ubuntu `.deb` and macOS `.dmg` artifacts to the created release
   - converted `.github/workflows/ubuntu-deb.yml` to manual-only fallback (`workflow_dispatch`) to prevent duplicate auto-release uploads

## Open items
- Validate end-to-end first-run behavior in live Tauri runtime: EULA accept → dependency checks/install attempts → normal app readiness.
- Consider adding explicit per-package install status rows in UI (ffmpeg / whisper.cpp / python whisper) instead of only aggregate status text.
- Resolve macOS traffic-light controls (close/minimize/zoom) not reappearing after compact → general transition.
- Determine whether fix requires Rust-side native window restoration in `src-tauri/src/main.rs` instead of (or in addition to) JS-side sequencing.
- Validate final native About icon behavior in real app runtime (dev + packaged).
- Confirm no regression in menu interactions after About metadata updates.
- Run a final interactive usability pass for icon discoverability and keyboard flow.

## Known issues (latest)
- **Current blocker:** On macOS, titlebar traffic-light controls remain hidden after returning from compact mode, even though decorations/resizable/titleBarStyle restoration calls succeed at build-time validation and window centering works at runtime.
- EULA-gated bootstrap is now implemented in code, but first-run interactive verification is still pending to confirm UX timing and messaging under real install conditions (especially when Homebrew/package installs take time).
- Prior runtime error when About icon was configured with path string instead of image data; implementation has been adjusted accordingly and still needs final runtime verification in packaged usage.
