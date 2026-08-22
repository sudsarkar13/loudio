# v1.0.2 — Stable Release

Transcription now works on Linux, and the package presents itself properly in
software stores.

## What's Changed

### 🐛 Fixed Bugs & Issues
- **Linux transcription is fixed.** `whisper-cli` installed as a snap is confined
  and cannot read dot-directories under `$HOME`, which is where Loudio keeps its
  runtime. Audio and models are now staged into `~/snap/whisper-cpp/common/loudio`
  before the engine runs, so "Primary engine failed, trying Python fallback" no
  longer fires on a healthy install.
- Model downloads resume, verify their size and are renamed into place, so an
  interrupted download no longer leaves a truncated model that fails on every
  later run.
- Engine errors now say what actually went wrong: stderr is captured and the last
  line is surfaced instead of discarded. Engine processes are killed when dropped
  rather than left running.
- Microphone captures are always converted to 16 kHz mono before transcription,
  in a work directory kept separate from recordings so history stays correct.
- Dependency installation on Linux uses the system package manager instead of
  being routed through Homebrew.
- The Engine path setting suggested `/opt/homebrew/bin/whisper-cli` on every
  platform. It now suggests a path that exists on the platform you are running.

### 🚀 Highlights & Features
- **The menu is available from the system tray on Linux.** GNOME has no global
  menu bar, so the app menu is now mirrored into a tray indicator. Compact mode
  hides the in-window menu bar, which was consuming about 14% of that window.
- **Store listings show real information.** The package now carries AppStream
  metadata, so software centres display the Loudio name, description, MIT
  licence, icon and screenshots rather than a lowercase "loudio" with no
  description and Unknown License.
- The package includes a machine-readable copyright file, which it previously
  omitted entirely.

### 📦 Packaging
- Releases ship a Debian package and both macOS architectures. The AppImage
  target was removed.
- On Linux the package pulls in `libayatana-appindicator3-1` for the tray, and
  recommends the GNOME AppIndicator extension. Without an indicator host the tray
  is simply absent and the in-window menu bar is used instead.

## Known Limitations
- `ffmpeg` and `whisper-cli` are not bundled. The readiness wizard installs them
  on first run; the install instructions below cover doing it manually.
- macOS builds are unsigned unless signing secrets are configured, so first
  launch needs right-click → Open.
