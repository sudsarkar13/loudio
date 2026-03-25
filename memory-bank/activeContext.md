# Active Context — Loudio

## Current focus
Stabilize compact ↔ general window transitions for macOS so that exiting compact mode restores native traffic-light controls (close/minimize/zoom) while preserving centered general-window restoration behavior.

## Recently completed work
- Kept compact-mode architecture and center-restore logic in place.
- Updated compact-mode exit button label in `TranscriptionStudio.tsx` from **"Full"** to **"General"** (name-only change requested by user).
- Extended Tauri window capability permissions in `src-tauri/capabilities/default.json` (already applied earlier) to include:
  - `core:window:allow-set-title-bar-style`
  - `core:window:allow-set-fullscreen`
  - `core:window:allow-unmaximize`
  - `core:window:allow-show`
  - `core:window:allow-set-focus`
- Investigated Tauri window typings and confirmed `TitleBarStyle` values are lowercase in v2 (`'visible' | 'transparent' | 'overlay'`).
- Updated `app/lib/tauri.ts` restore path to use lowercase `setTitleBarStyle("visible")` and retained macOS-specific staged restore flow:
  - unset always-on-top
  - set title bar style (best effort)
  - re-enable decorations
  - short wait on macOS
  - re-enable resizable
  - show/focus (best effort)
  - short wait and re-assert decorations on macOS
- Build/compile validation passed after updates:
  - `npm run -s tsc -- --noEmit --pretty false`
  - `npm run -s tauri build 2>&1`

## Validation status
- Static/build validations are green.
- Runtime behavior is partially correct:
  - ✅ Compact → general returns window to center.
  - ✅ Compact toggle naming now aligns with “General”.
  - ❌ macOS traffic-light controls still not visible after restoring from compact mode (latest user runtime verification).

## Immediate next checks
- Validate whether decorations-only restoration is insufficient on macOS and requires a Rust-side native window operation (or a different Tauri API sequence) to rehydrate standard title bar controls.
- If needed, move restoration orchestration for macOS into `src-tauri/src/main.rs` with explicit platform-conditional handling.
- Re-test compact → general flow in live runtime after any Rust-side restore strategy.
