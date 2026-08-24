# Store distribution plan — Flathub and the Snap Store

> **Status:** planned, not started. No code changes made.
> **Decision taken:** publish to **both** Flathub and the Snap Store.
> **Prerequisite for both:** rename the application ID (see below).
> **Confinement:** strict — decided, see Decisions.
> **Build divergence:** accepted, with an install-flavour indicator — decided.
> **Stage 4:** deferred to **v1.0.5**, after both store launches.
> **Now in progress:** the store launches themselves, working down the
> sequencing list below.

## Why this work exists

Loudio's store page shows the package name `loudio`, an "Unknown License" warning,
no screenshots and "No details for this release" — despite shipping correct
AppStream metadata since v1.0.2.

The metadata is not broken. `appstreamcli` parses it and resolves the name
`Loudio`, `project_license: MIT`, all five screenshots and the full per-release
description. The screenshot URLs return HTTP 200.

The store simply never reads it. GNOME Software on Ubuntu 24.04 builds its
catalog **exclusively from the OS catalog** — the AppStream data Ubuntu generates
from the APT archive. Metainfo shipped inside a `.deb` is never indexed. Measured
on a live Ubuntu 24.04 system, across every desktop-application component that
ships a metainfo file:

| Category | Count |
| :-- | --: |
| In the OS catalog **and** indexed by the store | 33 |
| Local metainfo only, **but indexed** | **0** |
| Local metainfo only, not indexed | 2 |

The two unindexed ones are `org.gnome.Snapshot` and `org.gnome.SystemMonitor` —
GNOME's own apps, same symptom, same cause.

The consequence, and the reason packaging is the only fix: **when Loudio is not
installed, its metainfo is not on the machine at all.** A store can only show a
page for a not-installed app if that app is in a catalog the store indexes.
Loudio is a `.deb` on GitHub Releases, which is in no catalog anywhere. No
amount of metadata work on the `.deb` can change this.

## Shared prerequisite — rename the application ID

Current ID is `com.loudio.desktop`, which asserts ownership of the domain
`loudio.com`. Flathub requires the ID's domain to be one the developer controls
and reachable over HTTPS, or one of the code-hosting prefixes. For a project
hosted at `github.com/sudsarkar13/loudio` the required form is:

```
io.github.sudsarkar13.loudio
```

Four components, which satisfies Flathub's minimum. This matches the convention
used by comparable apps already on Flathub (`io.github.chidiwilliams.Buzz`).

**Files this touches:** `src-tauri/tauri.conf.json` (`identifier`), the metainfo
filename and `<id>`, the `deb.files` install path, `<launchable>`, and the
`docs/screenshots` references stay as they are.

### The migration risk this creates

Tauri derives the per-user data directory from `identifier`. Today that is
`~/.local/share/com.loudio.desktop`, holding `settings.json`, `readiness/`,
`runtime/` and recorded audio. Changing the identifier moves that directory, so
existing installs would start from an empty state.

Half of this is already solved. `src-tauri/src/recordings.rs` carries a
`KNOWN_BUNDLE_IDS` list — Loudio has already renamed three times
(`com.lexprotech.loudio`, `com.loudio.app`, `com.loudio.desktop`,
`dev.loudio.app`) and migrates recordings out of any of them.

**The gap:** that machinery migrates *recordings only*. It does not migrate
`settings.json`. Since v1.0.3 that file holds the custom vocabulary and the
learned-corrections dictionary, so a rename would silently discard everything the
user has taught the app. Extending the migration to cover `settings.json` is a
hard prerequisite of the rename, not an optional extra.

## What both routes change about the app itself

Loudio currently shells out to `ffmpeg` and `whisper-cli` and asks the user to
install them through the readiness wizard. Both stores require those to be part
of the package.

Flathub is explicit: *"Applications that rely on host components or complicated
post installation setups for core functionality will not be accepted."* The
readiness wizard, as it works today, is disqualifying.

So both packages must bundle the engines — which means **the dependency wizard
disappears inside them**. Arguably a bigger user-facing win than the screenshots:
install, launch, transcribe, with no setup step at all. The wizard stays for the
`.deb` and `.dmg`, so it must become conditional on how Loudio was installed
rather than being removed.

Runtime *model* downloads remain fine. Flathub's prohibition covers executables,
and there is direct precedent: Buzz and Speech Note both ship on Flathub and
download Whisper models at runtime with the network permission.

## Route A — Flathub

Verified against the runtimes installed on this machine:

| Need | Status |
| :-- | :-- |
| WebKitGTK for Tauri | ✅ `org.gnome.Platform` 49 and 50 both ship `libwebkit2gtk-4.1.so.0` |
| `ffmpeg` CLI | ✅ present in the runtime at `files/bin/ffmpeg` — **zero bundling needed** |
| `whisper.cpp` | ❌ must be built as a manifest part from a pinned tarball |
| Model download at runtime | ✅ allowed with `--share=network` (Buzz precedent) |

Permissions to request: `--socket=pulseaudio` (microphone), `--share=network`
(model downloads), and the file-chooser portal for importing audio rather than
broad `--filesystem=host`.

### The hard part: no network during the build

Flathub builds are offline. Every dependency must be declared as a source with a
URL and checksum. Loudio's graph is **538 cargo crates and 78 npm resolutions**,
all of which must be vendored via `flatpak-builder-tools`
(`flatpak-cargo-generator.py` and `flatpak-node-generator`), and the generated
manifests regenerated on every dependency bump.

This is a well-trodden path but it is the single largest cost in this plan, and
it recurs at every release.

Submission is a pull request to the `flathub/flathub` repository, followed by
review.

## Route B — Snap Store

Verified against the snaps installed on this machine:

| Need | Status |
| :-- | :-- |
| WebKitGTK for Tauri | ✅ `gnome-46-2404` ships `libwebkit2gtk-4.1.so.0` — use `base: core24` + the `gnome` extension |
| `ffmpeg` | ✅ the `ffmpeg-2404` content snap is available (already installed here) |
| `whisper.cpp` | ❌ build as a part — but **the snap build has network access**, so no vendoring |
| Screenshots | ⚠️ see below |
| Snap name | ✅ `loudio` registered 2026-08-24 to publisher `sudsarkar13`, public |

Interfaces to declare: `audio-record`, `audio-playback`, `network`, `desktop`,
`wayland`, `x11`, `opengl`, `home`, `removable-media`.

### Screenshots are not adopted from metainfo

Snapcraft's `adopt-info` / `parse-info` reads an AppStream file for **title,
version, summary, description, icon and the `.desktop` path — screenshots are
not in that list**. Snap Store screenshots are uploaded through the store listing
page.

So the Snap Store listing becomes a **second place to maintain**, and it can
drift from `docs/screenshots/` unless a release step keeps them in sync.

### The confinement lesson we already paid for

v1.0.2 fixed Linux transcription because `whisper-cli` installed as a snap is
confined and cannot read dot-directories under `$HOME`, so Loudio stages audio
into `~/snap/whisper-cpp/common/loudio`. Making *Loudio itself* a confined snap
inverts that relationship, and `prepare_engine_workspace` in
`src-tauri/src/transcription.rs` must be re-derived from scratch for the case
where both sides are confined. Assume this is where the time goes.

## Recommended sequencing

**Snap first, Flathub second.** Not because the Snap Store is the better listing
— Flathub renders our metainfo directly, including screenshots, and this machine
already indexes Flathub — but because the snap build has network access and needs
no dependency vendoring. It gets a real store listing up while proving out the
bundled-engine work, which both routes share. Flathub then reuses that work and
only adds the vendoring.

1. ~~Extend `settings.json` migration to cover renamed bundle IDs~~ — **done**,
   along with a persist-on-mount bug that was overwriting stored settings with
   defaults before anything read them, and a `runtime/` move so the rename does
   not strand a multi-gigabyte virtualenv and the downloaded models
2. ~~Rename the application ID to `io.github.sudsarkar13.loudio`~~ — **done**
3. ~~Make the readiness wizard conditional on install method~~ — **done**
4. ~~Bundle `whisper.cpp`; take `ffmpeg` from the platform in each case~~ —
   **done**; binary resolution prefers bundled copies inside a sandbox
5. Snap: **builds in CI** — an 87 MB snap carrying `loudio`, `whisper-cli` and
   `ffmpeg`. Still to do: run it under strict confinement and transcribe once
6. Snap: upload screenshots to the store listing
7. Flathub: manifest written and building locally; **still needs offline
   vendoring** — 538 crates and the Yarn Berry cache — before it can be submitted
8. ~~CI: build both on tag~~ — snap builds on every push and publishes to `beta`
   after the GitHub release; Flathub builds on its own infrastructure

### Note on the snap toolchain

`build-snaps: [rustup]` cannot be used with the `gnome` extension. The extension
puts its SDK ahead of the system on `LD_LIBRARY_PATH`, and a snap-provided
binary built against a different glibc then dies with `undefined symbol:
__nptl_change_stack_perm, version GLIBC_PRIVATE`. Node and Rust are downloaded
into the part's build directory instead. The archive's `rustc` is not an option
either: core24 ships 1.75 and `Cargo.toml` requires 1.77.

## Decisions

### 1. Strict confinement — and no fallback plan for classic

Everything Loudio does maps onto standard interfaces: `audio-record`, `network`,
and the file portal for choosing audio. The confinement pain in v1.0.2 came from
Loudio, running unconfined from a `.deb`, reaching *into* a confined
`whisper-cpp` snap. Once both sides live inside the same snap that boundary does
not exist, so the problem disappears rather than deepening.

The deciding argument is that Flathub leaves no alternative. Flatpak is sandboxed
with portals and has no classic equivalent, so the sandbox-compatible design has
to be built regardless. Choosing classic for the snap would mean maintaining two
architectures for no gain, and classic requires manual Canonical review that is
routinely refused precisely when strict would work.

Both packages use XDG portals for file access rather than broad `home`, since
that is the part that ports between them. Escalate to classic only against a
specific, named blocker — and record it here when it appears.

### 2. Store and direct builds may diverge, but the app must say which it is

Bundling engines everywhere is the wrong correction: it takes the `.deb` from
6 MB to well over 100 MB, and a private ffmpeg copy inside a `.deb` duplicates a
system package most users already have.

The real problem is not that behaviour differs — it is not knowing which build a
bug report came from. So Loudio detects its install flavour at runtime (the
`SNAP` and `FLATPAK_ID` environment variables, or a build flag) and surfaces it
in the readiness card, the About dialog, and any engine error message.
"Engines: bundled" versus "Engines: system" turns an ambiguous report into a
specific one.

Revisit only on evidence: if the store builds prove materially more reliable,
that is a real argument for bundling everywhere.

## Deferred — recorded, not being acted on

### 3. The stage 4 model: download rather than bundle

[Stage 4](STAGE_4_PLAN.md) currently assumes a bundled 253 MB Gemma model. The
argument against bundling is that **it does not actually buy offline-first,
because the Whisper model still downloads.** Loudio is already unusable until its
first model download finishes, so adding 253 MB to every artifact makes four
downloads larger without changing that. Bundling only delivers
offline-on-first-launch if the Whisper model is bundled too, which is a much
larger decision.

Meanwhile the download path already exists, is consent-gated, resumable and
size-verified, and Flathub permits runtime *model* downloads — Buzz and Speech
Note both do exactly this. Structuring is also off by default, so bundling would
make every user download 253 MB for an optional feature.

**Deferred to v1.0.5.** Both store launches come first, so that version
control and changelogs are established before a model lands in the packages.

## Release pipeline shape — the target we are building toward

Flathub decouples itself: their buildbot builds and publishes from the
`flathub/<id>` repository after a push, with nothing built or uploaded from our
CI. So this is three artifacts in the tag pipeline — `.deb`, `.dmg`, `.snap` —
plus a Flathub repo updated after a release exists.

The intended shape, when we get to it:

- Snap builds on tag and publishes to **`beta`, never straight to `stable`**;
  promotion is manual after verification. Snaps auto-update, so a broken
  `stable` is far more damaging than a bad `.deb` sitting on a releases page.
- The snap upload runs **after** the GitHub release publishes, as its own job, so
  a store failure cannot block the `.deb` and `.dmg` from shipping.

The risk is flake surface, not job count — as the `hdiutil` failure during the
v1.0.3 release showed. That is already covered: the workflow is idempotent and
re-runnable with `gh workflow run release.yml -f tag=…`.

This is step 8, the *end* of the sequencing list rather than the start: there is
no snap job to write until `snapcraft.yaml` exists and builds.
