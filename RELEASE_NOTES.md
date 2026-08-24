# v1.0.3 — Stable Release

Transcription can be taught the words you actually use, and the engines Loudio
depends on stay current without ever pulling in a pre-release.

## What's Changed

### 🚀 Highlights & Features

- **Teach it your vocabulary.** Settings now takes a list of the terms you
  actually say — product names, tools, acronyms. They are passed to the engine as
  an initial prompt carried across every window of audio, which steers decoding
  *before* the mistake happens rather than patching it afterwards. This is what
  makes "supabase" stop arriving as "super base", and it is why Loudio can now
  recognise its own name.

- **Correct it once.** When you edit a transcript, Loudio spots the change and
  offers it as a `heard → intended` pair. Confirm it and the correction applies to
  every transcript from then on; confirm the same one again and it gains weight
  rather than being stored twice. Nothing is ever learned without your
  confirmation.

- **Stable updates only.** Loudio compares your installed `whisper.cpp` and
  FFmpeg against what your package manager offers, and reports an update only when
  the candidate is both a stable release *and* strictly newer. This matters more
  than it sounds: a `whisper-cpp` snap can sit on a beta revision that is ahead of
  what `latest/stable` serves, so "install the latest" would pull a beta and
  "install stable" would silently downgrade you. Loudio does neither.

- **Nothing installs without consent.** An available update is surfaced, never
  applied. Installing it takes a deliberate two-step confirmation.

### 🐛 Fixed Bugs & Issues

- Apple Silicon detection used a fixed list of families, so an M5 came back
  unknown and an M10 would have been misread as an M1. The generation is now
  parsed from the brand string.
- The readiness wizard showed `python3` as your Python version and
  `app-local venv` as your Whisper version — a command name and a folder, neither
  of them a version. Both now report what is actually installed.
- Release artifact verification treated every file in the bundle directory as an
  artifact, including a helper script Tauri leaves behind, which failed the
  v1.0.2 release build. Only real bundles are checked now.
- AppStream metadata used AppStream 1.0-only tags, so it validated locally but
  failed on Ubuntu 22.04. It now parses on both.

### 🧹 Changed

- **Intel macOS builds are discontinued.** macOS is deprecating x86_64
  application support, so this release ships a single Apple Silicon `.dmg`.
  Existing Intel installations keep working but will not receive further updates.
