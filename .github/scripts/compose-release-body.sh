#!/usr/bin/env bash
# Builds the GitHub Release description: the hand-written notes for this
# version, followed by an auto-generated download and install section derived
# from the assets actually present in ./dist.
#
# Requires: TAG, CHANNEL, REPO in the environment; ./dist populated.
set -euo pipefail

TAG="${TAG:?TAG required}"
CHANNEL="${CHANNEL:?CHANNEL required}"
REPO="${REPO:?REPO required}"
BASE="https://github.com/$REPO/releases/download/$TAG"

# First asset matching a glob, or empty when that platform was not built.
asset() {
  local match
  match=$(find dist -maxdepth 1 -name "$1" -printf '%f\n' 2>/dev/null | head -n 1)
  printf '%s' "$match"
}

DEB=$(asset '*.deb')
DMG_ARM=$(asset '*aarch64.dmg')

if [ -f RELEASE_NOTES.md ]; then
  cat RELEASE_NOTES.md
  echo
fi

echo "---"
echo
echo "## Downloads"
echo
echo "| Platform | File |"
echo "| :-- | :-- |"
[ -n "$DMG_ARM" ]  && echo "| macOS — Apple Silicon (M1 and later) | [\`$DMG_ARM\`]($BASE/$DMG_ARM) |"
[ -n "$DEB" ]      && echo "| Ubuntu / Debian | [\`$DEB\`]($BASE/$DEB) |"
echo "| Checksums | [\`SHA256SUMS\`]($BASE/SHA256SUMS) |"
echo

echo "## Install"
echo

if [ -n "$DEB" ]; then
  cat <<INSTALL
### Ubuntu / Debian

\`\`\`bash
sudo apt install ./$DEB
\`\`\`

Loudio transcribes locally, so it needs two runtime dependencies. Install them
once — or use **Help → Run Runtime Bootstrap** in the app, which does the same
thing:

\`\`\`bash
sudo apt-get install -y ffmpeg
sudo snap install whisper-cpp
sudo snap alias whisper-cpp.cli whisper-cli
\`\`\`

The first transcription downloads the Whisper model (~490 MB for \`small\`) into
\`~/.local/share/io.github.sudsarkar13.loudio/runtime/models\`. That is a one-time cost and
everything after it runs offline.

INSTALL
fi

if [ -n "$DMG_ARM" ]; then
  cat <<'INSTALL'
### macOS

Apple Silicon only (M1 and later). Intel Macs are no longer supported, because
Apple is ending Intel support in macOS.

Open the `.dmg` and drag Loudio to Applications. Builds are unsigned unless
release signing is configured, so the first launch needs
**right-click → Open** to get past Gatekeeper.

Runtime dependencies install through Homebrew, either by hand or via
**Help → Run Runtime Bootstrap**:

```bash
brew install ffmpeg whisper-cpp
```

INSTALL
fi

cat <<'VERIFY'
## Verify your download

```bash
sha256sum -c SHA256SUMS --ignore-missing
```
VERIFY

echo
echo "_Channel: $CHANNEL._"
