# Changelog

All notable changes to Loudio are recorded here. Each released version has a
heading containing its tag in square brackets — the release pipeline refuses to
publish a tag with no matching section.

## [Unreleased]

### 🐛 Fixed Bugs & Issues
- **Speech in any language other than English was silently rewritten as
  English.** whisper.cpp defaults its language flag to `en` rather than
  auto-detect, and "Auto Detect" was never passed to the engine — so Hindi came
  out as English prose and looked like a bad transcription rather than a wrong
  setting. The chosen language, including auto, now always reaches the engine,
  and the detected language is read back from it.
- **The compact window disappeared after a reload on HiDPI displays.** Its
  position was saved in physical pixels and restored as logical ones, so each
  reload moved it further off-screen until it was gone. Positions are stored in
  logical pixels and clamped to a visible screen.
- **Recordings could capture the same speech twice, or produce a file that
  would not play.** A second recorder could start before the first had finished
  opening — two streams writing one buffer. The duplicated audio and the
  unplayable fragment were the same bug seen from two sides.
- **`.webm` recordings would not play back.** A recording whose header was
  missing is now repaired before playback rather than failing silently.
- **Loudio asked for microphone access on every launch, even once granted.**
  WebKit does not expose an existing OS grant to the page: its permission query
  is unimplemented, and device labels stay empty until capture succeeds *in that
  session*. Both signals therefore read as "denied" on every cold start. The
  grant is now remembered and quietly re-established at launch.
- **The Python environment could be built for the wrong CPU architecture.** A
  bare `python3` resolved to the system interpreter under a packaged app's
  minimal `PATH`, producing an x86_64 environment on Apple Silicon.
- **Translated text dropped sentences.** Devanagari sentence boundaries were not
  recognised, so a whole paragraph was translated as one unit and truncated.

### 🚀 Highlights & Features
- **System Readiness opens in its own window.** It was a full-screen overlay
  inside the main window, which conflated the studio you work in with the
  preflight that decides whether the studio can run. Installing a dependency can
  take minutes; the main window stays usable throughout. Reachable from the
  status indicator, from **Help → System Readiness…**, and automatically when
  something needs attention.
- **Translate into languages other than English.** whisper.cpp can only
  translate *to* English, so a local NLLB-200 model now handles the rest.
  Transcribe keeps the spoken language; Translate targets English by default, or
  a language you choose.
- **Choose the translation model size.** The smaller model downloads roughly 3
  GiB and the larger one roughly 7 GiB; the choice is yours rather than assumed.
- **Downloads refuse to fill the disk.** Multi-gigabyte model downloads check
  free space first and keep a 2 GiB reserve.
- **Diagnostic logging.** Microphone and window events are written to a rotating
  on-disk log, reachable from **Help → Open Diagnostic Logs…**, so an
  intermittent failure can be diagnosed after the fact instead of reproduced on
  demand.

### 🧹 Changed
- Bumped Next.js from 16.2.9 to 16.3.4.

### 🔧 Development
- **Dev-only agent bridge.** A loopback, token-authenticated bridge that exposes
  the running development build — its state, its log, a screenshot of any of its
  windows, and its test suites — to an AI coding agent over MCP. Compiled out of
  release builds entirely, not merely disabled.

## [v1.0.4] - 2026-08-25

### 🐛 Fixed Bugs & Issues
- **Stored settings were being overwritten with defaults on startup.** The
  persist effect ran on mount with the default settings while loading was gated
  behind the readiness check, so anyone who quit before the app finished starting
  lost their settings — since v1.0.3 that included the custom vocabulary and
  every learned correction.
- **Keyboard shortcuts stopped working in compact mode on Linux.** Menu
  accelerators belong to the GTK menu bar, so hiding it for compact mode disabled
  `Ctrl+O`, `Ctrl+Enter`, `Ctrl+K`, `Ctrl+Shift+M` and the rest. They are handled
  directly while the bar is hidden.
- **`Ctrl+Q` never worked on Linux at all.** The predefined Quit item takes no
  accelerator and muda assigns none on Linux, where macOS gets `Cmd+Q` from the
  system.
- **The menu bar flashed on every recording start and stop.** Toggling a
  recording rebuilt the whole native menu, and re-applying it re-shows the GTK
  menu bar. The menu is built once and updated in place.
- The readiness wizard reported `python3` and `app-local venv` as versions —
  a command name and a location. Both now report what is actually installed.

### 🚀 Highlights & Features
- **Loudio is packaged for the Snap Store and Flathub.** Both bundle FFmpeg and
  whisper.cpp, so there is no dependency setup step at all: install, launch,
  transcribe. The readiness wizard detects a sandboxed install and stops
  offering actions it cannot perform there.

### 🧹 Changed
- **The application ID is now `io.github.sudsarkar13.loudio`.** The old
  `com.loudio.desktop` asserted ownership of a domain this project does not
  control, which the stores do not accept. Settings, downloaded models, the
  Python environment and recordings are carried across automatically on first
  launch — the runtime directory is moved rather than copied, so a multi-gigabyte
  environment is not duplicated.

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
