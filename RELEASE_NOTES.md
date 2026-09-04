# v1.0.6 — Stable Release

Three faults that only appeared in an installed copy of Loudio. Each one was
invisible to a build run from a terminal, which is why none of them surfaced
before release.

## What's Changed

### 🐛 Fixed Bugs & Issues

- **The macOS disk image opened as a plain list of files**, with nothing to drag
  the app onto. The window layout — its size, the icon sizes, and the app sitting
  beside the Applications folder — is written by Finder into a `.DS_Store`, and
  the bundler skips that step whenever it detects a CI environment. It printed no
  warning and failed nothing, so v1.0.4 and v1.0.5 both shipped an image with no
  layout at all. The release now opts back in, and refuses to publish an image
  whose layout is missing rather than letting another one through.

- **The installed app stopped reporting available FFmpeg and whisper.cpp
  updates.** Readiness looked up `brew` by name, but an app launched from Finder
  inherits a minimal `PATH` that contains neither Homebrew location. The lookup
  failed with "not found", which was read as "nothing to update" — so the badge
  never appeared once Loudio was installed rather than run under a development
  shell. Homebrew is now found by path.

- **The microphone stopped working after an in-app update**, with no permission
  prompt and only a raw error to go on. macOS ties a microphone grant to the
  app's code signature, so replacing the app invalidates it, and capture is then
  denied outright instead of being re-requested. Loudio now says what happened
  and how to restore access.

  Fully fixing this needs a stable Developer ID signature, which these builds do
  not yet carry. Until then, access has to be re-granted after each macOS update:
  re-enable Loudio under **System Settings › Privacy & Security › Microphone**,
  or run `tccutil reset Microphone io.github.sudsarkar13.loudio` and relaunch.
