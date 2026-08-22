# Changelog

All notable changes to Loudio are recorded here. Each released version has a
heading containing its tag in square brackets — the release pipeline refuses to
publish a tag with no matching section.

## [Unreleased]

## [v1.0.2] - 2026-08-22

### 🐛 Fixed Bugs & Issues
- Transcription on Linux now works end to end. `whisper-cli` installed as a snap
  cannot read dot-directories under `$HOME`, so audio and models are staged into
  `~/snap/whisper-cpp/common/loudio` before the engine is invoked.
- Model downloads are resumable and size-verified, then renamed into place, so an
  interrupted download no longer leaves a truncated model that fails silently.
- Engine stderr is drained and surfaced in the error message instead of being
  discarded, and child processes are killed on drop rather than orphaned.
- Microphone captures are always normalised to 16 kHz mono into a separate work
  directory, so history dedupe is unaffected.
- Linux dependency installation no longer routes through Homebrew.
- The Engine path field hinted `/opt/homebrew/bin/whisper-cli` on every platform.
  The placeholder now matches the platform actually running.

### 🚀 Highlights & Features
- The app menu is mirrored into a Linux tray indicator, and the in-window menu bar
  is hidden in compact mode where it cost roughly 14% of the window height.
- AppStream MetaInfo, a desktop-entry template and bundle metadata, so stores show
  the product name, description, MIT licence, icon and screenshots instead of a
  lowercase "loudio" with Unknown License.
- A DEP-5 machine-readable copyright at `/usr/share/doc/loudio/copyright`, which
  the package previously omitted entirely.

### 📦 Packaging & CI
- Packaging metadata is validated in CI and gated at release time: MetaInfo
  fields, the rendered desktop entry, built `.deb` control fields and every
  screenshot URL.
- The AppImage target was dropped; releases ship `.deb` and both macOS
  architectures.


## [v1.0.1] - 2026-06-28

### 🚀 Highlights & Features
- Recording history with per-capture dedupe, disk-usage reporting and legacy
  bundle-id migration.
- Platform-aware runtime profile labels, including Apple Silicon generation
  detection.

## [v1.0.0] - 2026-06-28

### 🚀 Highlights & Features
- First stable release: microphone capture with auto-transcribe on stop, audio
  file transcription, runtime bootstrap checks and the system readiness wizard.
- macOS (`.app`, `.dmg`) and Ubuntu (`.deb`) packaging.
