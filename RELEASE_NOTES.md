# v1.0.5 — Stable Release

Speech is transcribed in the language it was spoken, System Readiness moves into
its own window, and Loudio can now update itself.

## What's Changed

### 🐛 Fixed Bugs & Issues

- **Anything you said in a language other than English came back as English.**
  whisper.cpp defaults its language flag to `en` rather than auto-detect, and
  "Auto Detect" was never actually passed to the engine — so Hindi was rewritten
  as English prose, which looked like a bad transcription rather than a wrong
  setting. The language you pick, auto included, now always reaches the engine.

- **Loudio asked for microphone access on every single launch.** The webview
  cannot see an OS permission grant it already holds: its permission query is
  unimplemented, and device names stay hidden until capture succeeds *in that
  session*. Both signals therefore read as "denied" on every cold start. The
  grant is remembered now, and quietly re-established when the app opens.

- **The compact window drifted off screen after a reload.** Its position was
  saved in physical pixels and restored as logical ones, so on a Retina display
  every reload moved it further out until it vanished.

- **Recordings could capture the same speech twice, or produce a file that would
  not play.** A second recorder could start before the first had finished
  opening — two streams writing one buffer. The duplicated audio and the
  unplayable fragment were one bug seen from two sides.

- **The Python environment could be built for the wrong processor.** On Apple
  Silicon a bare `python3` resolved to the system interpreter under a packaged
  app's minimal `PATH`, producing an Intel environment on an ARM machine.

- **Translated text dropped whole sentences.** Devanagari sentence endings were
  not recognised, so a paragraph was translated as one block and truncated.

### 🚀 Highlights & Features

- **System Readiness is its own window.** It used to cover the app, which
  conflated the studio you work in with the preflight deciding whether the
  studio can run at all. Installing a dependency can take minutes; the main
  window now stays usable throughout. Reach it from the status indicator, from
  **Help → System Readiness…**, or automatically when something needs attention.

- **Loudio updates itself.** New releases are detected, downloaded and installed
  from inside the app, which then restarts. Nothing installs without your click.
  Snap and Flatpak builds show their version and leave updating to the store,
  which is the only thing that can update them.

- **Translate into a language you choose.** whisper.cpp can only translate *to*
  English, so a local NLLB-200 model now handles everything else. Transcribe
  keeps the spoken language; Translate targets English by default, or whichever
  language you pick. You choose the model size — roughly 3 GB or 7 GB.

- **Large downloads refuse to fill your disk.** Model downloads check free space
  first and keep a 2 GB reserve.

- **Diagnostic logging.** Microphone and window events are written to a rotating
  log, reachable from **Help → Open Diagnostic Logs…**, so an intermittent
  failure can be diagnosed after the fact instead of reproduced on demand.

### 🧹 Changed

- Updated Next.js from 16.2.9 to 16.3.4.
