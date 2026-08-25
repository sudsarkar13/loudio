---
name: release-manager
description: Standard operating procedure for cutting a Loudio release — bumping the version across package.json, tauri.conf.json and Cargo.toml, writing the changelog and release notes, and the tag-driven CI/CD pipeline that builds the .deb and the Apple Silicon .dmg, then publishes the GitHub Release on the correct channel (Stable/RC/Beta/Alpha) with checksums and install instructions. ONLY activate this skill when the user explicitly requests or initiates a new version release or version bump.
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

Six files declare the version and all must agree, or the release fails at
`validate`. Use the tool rather than editing by hand:

```bash
yarn version:set 1.1.0
yarn version:check          # prints the version; non-zero exit if they disagree
```

Rewritten automatically — [scripts/version.mjs](../../../scripts/version.mjs) is
the source of truth, see its `TARGETS`:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (tracked; anchored to the `loudio` entry, since many
  dependencies also declare a bare `version = "…"`)
- `lib/desktop-menu.ts` — the **Help → About Loudio** dialog, the only version
  string a user reads inside the app. It was hardcoded and drifting until v1.0.2.

**Checked but never rewritten**: `src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml`.
`version:set` prints a reminder instead, because every version needs its own
`<release>` block with real notes — relabelling the previous one would erase it.
Add the block by hand, then re-run `yarn version:check`.

`README.md` deliberately carries no hard-coded version.

### 2. Verify the build locally

```bash
yarn typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

Ensure `cargo check` compiles with **0 warnings**. If platform-specific traits or imports
are needed (such as `tauri::Manager` for Linux webview permission hooks in `src-tauri/src/main.rs`),
gate them with `#[cfg(target_os = "...")]` to prevent unused import warnings on macOS / Windows builds.

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

### 3b. Update the store metadata

The `.deb` ships an AppStream MetaInfo file that GNOME Software, KDE Discover and
the Ubuntu App Center read for the app's name, description, licence, screenshots
and per-release notes. Without it stores show the bare dpkg fields — which is how
Loudio appeared as "loudio" with a "(none)" description before v1.0.2.

Add a `<release>` block for this version in
[`src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml`](../../../src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml),
then validate:

```bash
appstreamcli validate --pedantic src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml
```

Screenshots are **not** packaged — stores fetch them from
`raw.githubusercontent.com/.../main/docs/screenshots/`. They must be committed and
pushed to `main` **before** publishing, or the store shows blank slots. Verify:

```bash
for n in 01-main-window 02-recording 03-settings 04-history 05-readiness; do
  printf '%-18s %s\n' "$n" "$(curl -s -o /dev/null -w '%{http_code}' \
    "https://raw.githubusercontent.com/sudsarkar13/loudio/main/docs/screenshots/$n.png")"
done
```

All five must return `200`. See [docs/screenshots/README.md](../../../docs/screenshots/README.md).

### 3c. Test the pipeline locally before pushing

The workflows can be exercised on this machine — no runner, no push. This is how
a retired `macos-13` runner label and three script bugs were caught before they
ever reached GitHub.

```bash
# Static analysis, including shellcheck on every `run:` block
actionlint .github/workflows/*.yml

# Store metadata: AppStream, desktop entry, referenced files
bash .github/scripts/validate-packaging.sh

# Screenshot URLs (strict; --warn-only for everyday CI)
bash .github/scripts/check-screenshots.sh

# Execute a job's shell steps locally. `uses:` steps, package installs and the
# long native builds are reported and skipped; everything else really runs.
bash .github/scripts/run-workflow-locally.sh .github/workflows/ci.yml packaging
bash .github/scripts/run-workflow-locally.sh .github/workflows/release.yml validate \
  inputs.tag=vX.Y.Z steps.resolve.outputs.tag=vX.Y.Z steps.resolve.outputs.version=X.Y.Z
```

And against a package you actually built:

```bash
yarn tauri build --bundles deb
bash .github/scripts/verify-deb-metadata.sh \
  src-tauri/target/release/bundle/deb/Loudio_X.Y.Z_amd64.deb
```

`actionlint` is not preinstalled; grab the single binary from
<https://github.com/rhysd/actionlint/releases>. The rest need only
`appstream`, `desktop-file-utils` and `python3`.

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

1. **validate** — parses the channel from the tag, asserts every manifest
   declares that exact version, requires matching `CHANGELOG.md` and
   `RELEASE_NOTES.md` entries, validates the AppStream and desktop metadata, and
   **requires every screenshot URL to return 200**.
2. **build-linux** — `.deb` on **ubuntu-22.04**. Pinned on
   purpose: binaries link against the runner's glibc, so building on 24.04 would
   exclude every 22.04 user. After building it runs
   [verify-deb-metadata.sh](../../../.github/scripts/verify-deb-metadata.sh)
   against the artifact, so store metadata cannot silently vanish.
3. **build-macos** — `.dmg` on `macos-14` (aarch64) only. Intel is deliberately
   not built: Apple is ending Intel Mac support and macOS warns on launch that
   the architecture is going away, so an x86_64 slice ships a deprecation
   notice rather than a usable build. The matrix is kept so a second arch can
   be re-added as one entry. **Do not use `macos-13`** — GitHub retired it, and
   `actionlint` will reject it. Signing and notarization are gated on secrets
   and skip cleanly when unset.
4. **publish** — downloads every artifact, generates `SHA256SUMS`, composes the
   body, and creates the release.

**Builds run before anything is published.** A failed build produces no release
at all, rather than a live release with zero downloads.

### 6. Verify

```bash
gh run watch --exit-status
gh release view v1.1.0 --repo sudsarkar13/loudio
```

Confirm the asset list carries all three files: `.deb`, the aarch64 `.dmg`,
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
- **The Linux menu lives in two places.** GNOME has no global menu bar, so
  [desktop-menu.ts](../../../lib/desktop-menu.ts) mirrors the app menu into a
  tray AppIndicator and hides the in-window menu bar while compact mode is
  active. The tray is best-effort: `libappindicator-sys` *dlopens*
  `libayatana-appindicator3.so.1`, so a host without it degrades to the
  in-window menu bar rather than failing to launch. That is why the
  appindicator packages are `recommends` and not `depends` — promoting them
  would make the package uninstallable on desktops that never needed them.
  Verify a release candidate actually registers by running the app and checking
  the item is listed:

  ```bash
  gdbus call --session --dest org.kde.StatusNotifierWatcher \
    --object-path /StatusNotifierWatcher \
    --method org.freedesktop.DBus.Properties.Get \
    org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems | grep -i loudio
  ```

  Duplicate entries, or an `IconName` pointing at a file that no longer exists
  under `/run/user/$UID/tray-icon/`, mean concurrent callers each created a
  tray and the dropped ones deleted the shared icon. `syncLinuxTrayMenu`
  caches the creation promise to prevent exactly that; do not replace the cache
  with a resolved-value check.
