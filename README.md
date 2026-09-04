<p align="center">
  <img src="public/loudio-logo.png" alt="Loudio logo" width="120" />
</p>

# Loudio

**Offline Transcription Studio for macOS + Ubuntu**  
Loudio is a desktop app built with **Tauri + Next.js** for fast, local transcription of both audio files and microphone recordings.

<p align="center">
  <a href="https://snapcraft.io/loudio">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://snapcraft.io/en/light/install.svg" />
      <img alt="Get it from the Snap Store" src="https://snapcraft.io/en/dark/install.svg" height="56" />
    </picture>
  </a>
</p>

## Install

### Ubuntu / Debian

The snap is the easiest route — it carries `ffmpeg` and `whisper.cpp` inside the
package, so there is nothing to install afterwards.

```bash
sudo snap install loudio --beta
```

It is on the **beta** channel while strict confinement gets real-world use; a
stable release follows once that is proven.

The `.deb` is the alternative for anyone who would rather not use snap. It uses
the system's `ffmpeg` and `whisper-cli`, so those have to be present:

```bash
# from https://github.com/sudsarkar13/loudio/releases/latest
sudo apt install ./Loudio_<version>_amd64.deb
```

### macOS

Download `Loudio_<version>_aarch64.dmg` from the
[latest release](https://github.com/sudsarkar13/loudio/releases/latest). The
build is ad-hoc signed rather than notarized, so the first launch needs
**right-click → Open** to get past the "unidentified developer" prompt.

Releases up to and including **v1.0.4** shipped without a bundle signature, so
macOS may instead refuse them with **"Loudio is damaged and can't be opened"** —
which right-click → Open cannot dismiss. Clear the quarantine flag instead:

```bash
xattr -dr com.apple.quarantine /Applications/Loudio.app
```

A Flathub package is in preparation.

## Why Loudio

Loudio is designed for users who want:
- Local/offline transcription workflows (privacy-friendly)
- A desktop-native experience (menu actions, shortcuts, packaging)
- Reliable microphone-to-text conversion with runtime checks and fallback behavior

## Highlights

- 🎙️ **Microphone recording + auto-transcribe on stop**
- 📁 **Audio file transcription** (`mp3`, `wav`, `m4a`, `flac`, `aac`, `ogg`)
- 🌐 **Transcribe in the spoken language, or translate into another** — whisper.cpp
  handles speech-to-text, a local NLLB-200 model handles non-English targets
- 🛡️ **System Readiness window** that checks, installs and updates the
  components Loudio needs, in its own window rather than blocking the app
- ⚙️ **Runtime bootstrap checks** for ffmpeg / whisper runtimes
- 🧠 **Multiple runtime profiles** (whisper.cpp + Python Whisper compatibility)
- ✨ **Live progress updates** during runtime setup and transcription
- 📋 **Copy and Clear transcript controls**
- 🕒 **Optional timestamp output**
- 🩺 **On-disk diagnostic logs** for microphone and window events
- 💾 **Disk-space guard** — large model downloads refuse to fill the drive
- 🧩 **Native desktop menu integration** (File/Edit/View/Window/Help)
- 🍎 **macOS packaging support** (`.app`, `.dmg`) with custom icons
- 🐧 **Ubuntu packaging support** (`.deb`) for Debian-based Linux distributions
- 📦 **Snap package** with `ffmpeg` and `whisper.cpp` bundled — no separate setup

## Tech Stack

- **Frontend:** Next.js 16 + React 19 + TypeScript
- **Desktop Runtime:** Tauri v2
- **Backend Engine:** Rust
- **Audio Conversion:** ffmpeg
- **Transcription Engines:** whisper.cpp and Python OpenAI Whisper
- **Translation:** NLLB-200 (local, for targets other than English)

## Project Structure

```text
loudio/
├── app/                 # Next.js App Router UI
│   └── readiness/       # Route behind the System Readiness window
├── components/          # React components
│   └── readiness/       # System Readiness window UI
├── lib/                 # Tauri bindings, diagnostics, shared helpers
├── public/              # Static assets (including logo)
├── src-tauri/           # Tauri + Rust backend and desktop config
├── scripts/             # Utility scripts
├── docs/                # Plans and platform notes
└── memory-bank/         # Project documentation/state files
```

Loudio ships two windows. The main studio is served from `/`, and System
Readiness from `/readiness/` — a second `WebviewWindow` created on demand, with
its own [capability file](src-tauri/capabilities/readiness.json). The trailing
slash pairs with `trailingSlash: true` in `next.config.mjs` so the route
resolves identically in `tauri dev` and in a packaged build.

## Prerequisites

- **Node.js** 20+
- **Yarn** (project uses Yarn 4)
- **Rust toolchain** (stable)
- **Cargo**
- **macOS** (for `.app` / `.dmg` builds)
- **Ubuntu 22.04+** or Debian-based Linux (for `.deb` builds)

> Loudio can bootstrap some runtime dependencies automatically at runtime (for example via Homebrew on macOS), but having a working local environment is still recommended.

## Getting Started

### 1) Install dependencies

```bash
yarn install
```

### 2) Run web UI only (Next.js)

```bash
yarn dev
```

### 3) Run desktop app in development (Tauri)

```bash
yarn tauri:dev
```

## Build

### Build web bundle

```bash
yarn build
```

### Build desktop app packages (default target set)

```bash
yarn tauri:build
```

### Build Ubuntu `.deb` package only

```bash
yarn tauri:build:deb
```

Outputs are generated under `src-tauri/target` (including macOS app/dmg artifacts when building on macOS and `.deb` artifacts when building on Linux).

## Available Scripts

From `package.json`:

- `yarn dev` — start Next.js dev server on port 3000
- `yarn build` — build Next.js app
- `yarn start` — run Next.js production server on port 3000
- `yarn lint` — run Next.js lint
- `yarn tauri:dev` — run Tauri desktop app in development
- `yarn tauri:build` — build Tauri desktop app packages for the current platform target set
- `yarn tauri:build:deb` — build Ubuntu/Debian package (`.deb`) only
- `yarn version:check` — assert `package.json`, `tauri.conf.json` and `Cargo.toml` all declare the same version
- `yarn version:set <version>` — bump the version across all three manifests

## Runtime Notes

Loudio checks and/or prepares:

- `ffmpeg` for audio normalization/conversion to WAV
- `whisper-cli` (whisper.cpp)
- Python whisper runtime in an app-local virtual environment (fallback compatibility path)
- An NLLB-200 translation model, downloaded only if you translate into a
  language other than English

This improves reliability for real-world microphone transcription workflows.

**Transcribe vs Translate.** Transcribe keeps whatever language was spoken.
Translate produces English by default, or the target language you pick. Because
whisper.cpp can only translate *to* English, any other target runs the
transcript through the local NLLB-200 model afterwards.

**Disk space.** Model downloads are large — an NLLB-200 model is roughly 3 GiB
or 7 GiB depending on which size you choose. Loudio checks free space first and
keeps a 2 GiB reserve rather than filling the drive.

## Validation

Recommended local checks:

```bash
npx tsc --noEmit
yarn build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
```

The release check matters on its own: the development-only agent bridge is
compiled out of release builds, so a change that only compiles in debug will
pass `cargo check` and still fail to ship.

## Troubleshooting

### Microphone conversion/transcription error
If you see an error similar to:

> Failed to convert microphone audio to wav with ffmpeg

try:
- Verifying `ffmpeg` is available in your PATH
- Running **Help → Run Runtime Bootstrap** inside the app
- Setting `LOUDIO_FFMPEG_PATH` if ffmpeg is installed in a non-standard location

### Loudio keeps asking for microphone access

Grant it once from the Settings panel. If the prompt returns on every launch,
check that microphone access is still allowed for Loudio in your OS privacy
settings — Loudio remembers the grant itself, and only forgets it when the
system actually denies capture.

Note that a locally built app and an installed one are separate identities to
the OS, so each asks once in its own right.

### Something is missing and Loudio will not transcribe

Open **Help → System Readiness…**. It reports what is installed, what is
missing and what has an update available, and can install most of it for you —
or hand you the exact command to run yourself.

## Releases

Releases are **tag-driven**. Pushing an annotated `v*` tag runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
every artifact and publishes the GitHub Release:

| Artifact | Platform |
| :-- | :-- |
| `Loudio_<version>_aarch64.dmg` | macOS, Apple Silicon (M1 and later) |
| `Loudio_<version>_amd64.deb` | Ubuntu / Debian |
| `loudio_<version>_amd64.snap` | Ubuntu / any snapd distribution |
| `SHA256SUMS` | checksums for all of the above |

Intel Macs are not built for. Apple is ending Intel support in macOS, and an
x86_64 build warns on launch that its architecture is going away, so shipping
one would hand users a deprecation notice rather than a working option.

The channel comes from the tag — `v1.1.0` is Stable, while `v1.1.0-rc.1`,
`v1.1.0-beta.1` and `v1.1.0-alpha.1` publish as prereleases and are never marked
latest.

```bash
yarn version:set 1.1.0        # bump all three manifests
# update CHANGELOG.md and RELEASE_NOTES.md — the pipeline requires both
git commit -am "Release v1.1.0: ..." && git push origin main
git tag -a v1.1.0 -m "v1.1.0 — Stable Release" && git push origin v1.1.0
```

The full procedure lives in
[`.claude/skills/release-manager/SKILL.md`](.claude/skills/release-manager/SKILL.md).

## License

This project is licensed under the terms in the [LICENSE](./LICENSE) file.

## Author

Created by **Sudeepta Sarkar**.
