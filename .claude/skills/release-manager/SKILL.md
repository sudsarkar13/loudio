---
name: release-manager
description: Standard operating procedure for cutting a Loudio release — bumping the version across package.json, tauri.conf.json and Cargo.toml, writing the changelog and release notes, and the tag-driven CI/CD pipeline that builds the .deb, .AppImage and both .dmg architectures, then publishes the GitHub Release on the correct channel (Stable/RC/Beta/Alpha) with checksums and install instructions. ONLY activate this skill when the user explicitly requests or initiates a new version release or version bump.
---

# Release Manager Skill

> **ACTIVATION RULE**: Only run this when the maintainer explicitly asks for a
> release or version bump. Do not auto-trigger for routine edits or bug fixes.

Releases are **tag-driven**. You prepare the commit; pushing an annotated tag
runs [.github/workflows/release.yml](../../../.github/workflows/release.yml),
which builds every artifact and publishes the release. There is no manual
`gh release create` step — running one by hand risks a half-published release.

Bumping the version in a commit does **nothing** on its own. The old
`create-release-on-version-bump.yml` workflow was removed at this change; a
`package.json` edit is no longer a release trigger.

---

## 📌 Versioning & Channels

The channel is parsed from the tag by the `validate` job. Nothing else selects it.

| Channel | Tag format | GitHub Release |
| :-- | :-- | :-- |
| **Stable** | `v1.1.0` | marked latest |
| **Release Candidate** | `v1.1.0-rc.1` | prerelease |
| **Beta** | `v1.1.0-beta.1` | prerelease |
| **Alpha** | `v1.1.0-alpha.1` | prerelease |

Only Stable gets `make_latest`, so a prerelease never becomes the download the
repository front page advertises. Prereleases remain fully downloadable from the
releases list — the gate is about what is *advertised*, never about what users
may *take*.

Release titles are generated as `Loudio <tag> — <Channel>`. Do not hand-write them.

---

## 📋 Standard Operating Procedure

### 1. Bump the version everywhere (one command)

Three manifests must agree or the release fails at `validate`. Use the tool
rather than editing by hand:

```bash
yarn version:set 1.1.0
yarn version:check          # prints the version; non-zero exit if they disagree
```

Covered files — [scripts/version.mjs](../../../scripts/version.mjs) is the
source of truth, see its `TARGETS`:
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.

`README.md` deliberately carries no hard-coded version.

### 2. Verify the build locally

```bash
yarn typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

For anything touching the transcription engines, also run the app and transcribe
once on the platform you changed. `cargo check` passing has never been evidence
that transcription works — the v1.0.1 Linux failures all compiled cleanly.

### 3. Write the changelog and release notes

Both are **required by the pipeline**; `validate` fails when either omits the tag.

`CHANGELOG.md` — prepend a section whose heading contains `[vX.Y.Z]`:

```markdown
## [v1.1.0] - YYYY-MM-DD

### 🐛 Fixed Bugs & Issues
- ...

### 🚀 Highlights & Features
- ...
```

`RELEASE_NOTES.md` — replace the contents with the delta for **this version
only**. Never paste the whole changelog: this file becomes the top of the
GitHub Release description, above the auto-generated download and install
sections.

```markdown
# v1.1.0 — Stable Release

## What's Changed

### 🐛 Fixed Bugs & Issues
- ...
```

Do **not** hand-write download links, install commands or checksums into
`RELEASE_NOTES.md`. [compose-release-body.sh](../../../.github/scripts/compose-release-body.sh)
generates all of that from the artifacts actually produced, so hand-written
copies drift and lie.

### 4. Commit and push, then wait for CI

```bash
git add -A
git commit -m "Release v1.1.0: <one-line summary>"
git push origin main
```

Wait for [CI](../../../.github/workflows/ci.yml) to pass on `main` before tagging.

### 5. Tag — this triggers the release

```bash
git tag -a v1.1.0 -m "v1.1.0 — Stable Release"
git push origin v1.1.0
```

The pipeline then runs:

1. **validate** — parses the channel from the tag, asserts all three manifests
   declare that exact version, and requires matching `CHANGELOG.md` and
   `RELEASE_NOTES.md` entries.
2. **build-linux** — `.deb` and `.AppImage` on **ubuntu-22.04**. Pinned on
   purpose: binaries link against the runner's glibc, so building on 24.04 would
   exclude every 22.04 user.
3. **build-macos** — `.dmg` on `macos-14` (aarch64) and `macos-13` (x86_64) in a
   matrix. Both are needed; before this existed, Intel Mac users got no build at
   all. Signing and notarization are gated on secrets and skip cleanly when unset.
4. **publish** — downloads every artifact, generates `SHA256SUMS`, composes the
   body, and creates the release.

**Builds run before anything is published.** A failed build produces no release
at all, rather than a live release with zero downloads.

### 6. Verify

```bash
gh run watch --exit-status
gh release view v1.1.0 --repo sudsarkar13/loudio
```

Confirm the asset list carries all five files: `.deb`, `.AppImage`, two `.dmg`,
and `SHA256SUMS`. Then install the **published** artifact — not your local
build — and transcribe once:

```bash
gh release download v1.1.0 --repo sudsarkar13/loudio --pattern '*.deb'
sha256sum -c SHA256SUMS --ignore-missing
sudo apt install ./Loudio_1.1.0_amd64.deb
```

---

## 🔁 Re-running a failed release

The workflow is idempotent — `softprops/action-gh-release@v2` updates an
existing release rather than erroring. Re-run without creating a new version:

```bash
gh workflow run release.yml -f tag=v1.1.0
```

Use this whenever a build fails for an environmental reason. Never delete and
re-push a tag that has already published assets; people may have downloaded them.

---

## 📦 Platform notes

- **Apple signing is optional.** Set `APPLE_SIGNING_ENABLED=true` plus
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` and `APPLE_SIGNING_IDENTITY`
  to opt in; add `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` for
  notarization. With none set, builds are unsigned and users need
  right-click → Open on first launch. The workflow validates the certificate
  before building so a bad secret fails fast.
- **Runtime dependencies are not bundled.** Loudio shells out to `ffmpeg` and
  `whisper-cli`; neither ships inside the package. The generated install section
  tells users how to get them, and that text is the only place those
  instructions should live.
- **The Linux engine is snap-confined.** `snap install whisper-cpp` cannot read
  dot-directories in `$HOME`, so the app stages audio and models into
  `~/snap/whisper-cpp/common/loudio` before invoking it. If you ever change
  where Loudio stores runtime files, re-check
  [`prepare_engine_workspace`](../../../src-tauri/src/transcription.rs).
