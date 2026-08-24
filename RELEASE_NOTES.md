# v1.0.4 — Stable Release

Compact mode gets its keyboard shortcuts back, settings stop disappearing, and
Loudio is now packaged for the Snap Store and Flathub.

## What's Changed

### 🐛 Fixed Bugs & Issues

- **Your settings could be silently reset.** Loudio wrote its default settings to
  disk as soon as the window appeared, while reading the stored ones waited on
  the readiness check. Quit before startup finished and the defaults had already
  replaced everything — including, since v1.0.3, your custom vocabulary and every
  correction you had taught it. Nothing is written now until the stored settings
  have been read.

- **Keyboard shortcuts were dead in compact mode on Linux.** Menu accelerators
  belong to the GTK menu bar, and compact mode hides that bar — which took
  `Ctrl+O`, `Ctrl+Enter`, `Ctrl+K` and `Ctrl+Shift+M` with it. They work again
  while the bar is hidden.

- **`Ctrl+Q` never worked on Linux.** macOS gets `Cmd+Q` from the system; on
  Linux the predefined Quit item is given no accelerator at all. It has one now.

- **The menu bar flashed whenever a recording started or stopped.** Toggling a
  recording rebuilt the entire native menu, and re-applying a menu re-shows the
  bar. It is built once and updated in place.

- The readiness wizard showed `python3` as your Python version and
  `app-local venv` as your Whisper version. Both now report the real thing.

### 🚀 Highlights & Features

- **Snap and Flatpak packages.** Both bundle FFmpeg and whisper.cpp, so there is
  no setup step: install, launch, transcribe. The readiness wizard recognises a
  sandboxed install and stops offering installs it cannot perform there.

### 🧹 Changed

- **The application ID changed to `io.github.sudsarkar13.loudio`.** The previous
  one claimed a domain this project does not own, which stores reject. Your
  settings, models, Python environment and recordings move across on first
  launch — the runtime directory is moved rather than copied, so several
  gigabytes are not duplicated. The old location is left in place.
