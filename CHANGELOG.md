# Changelog

All notable changes to Loudio are recorded here. Each released version has a
heading containing its tag in square brackets — the release pipeline refuses to
publish a tag with no matching section.

## [Unreleased]

## [v1.0.3] - 2026-08-24

### 🚀 Highlights & Features
- **Transcription can be taught your vocabulary.** Settings takes a list of terms
  you actually use — product names, tools, acronyms — and they are fed to the
  engine as an initial prompt that is carried across every audio window. This
  steers decoding *before* the mistake happens, so "supabase" stops arriving as
  "super base".
- **Corrections are learned once and reused.** Editing a transcript proposes the
  change as a `heard → intended` pair; confirming it stores the pair and applies
  it to every later transcript. Confirming the same correction again raises its
  weight instead of storing a duplicate. Nothing is learned without confirmation.
- **Engine updates are detected, but only stable ones.** Loudio compares the
  installed `whisper.cpp` and FFmpeg against what the platform's package manager
  offers and reports an update only when the candidate is both a stable release
  and strictly newer. Snap channels are read from `latest/stable` alone, so a
  beta revision is never offered as an upgrade and a downgrade is never proposed
  as one.
- **Updates install only with consent.** An available update is shown, never
  applied. Installing takes a deliberate two-step confirmation in the readiness
  card.

### 🐛 Fixed Bugs & Issues
- Apple Silicon detection matched a hardcoded list of families, so an M5 reported
  as unknown and an M10 would have been read as an M1. Generation is now parsed
  from the brand string.
- The readiness wizard reported `python3` as the Python version and
  `app-local venv` as the Whisper version — a command name and a location, not
  versions. Both now report the real installed version.
- Release artifact verification matched every file in the bundle directory, so
  Tauri's own `bundle_dmg.sh` helper was treated as a release artifact and failed
  the check. Only `.dmg`, `.deb` and `.AppImage` files are considered, and the
  temporary `rw.*.dmg` scratch image is skipped.
- AppStream metadata used tags that only exist in AppStream 1.0, so validation
  failed on Ubuntu 22.04 while passing locally. The metadata now parses on both.

### 🧹 Changed
- **Intel macOS builds are no longer produced.** macOS is deprecating x86_64
  application support, so releases now ship a single Apple Silicon `.dmg`.
  Existing Intel installs keep working; they will not receive further updates.

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
