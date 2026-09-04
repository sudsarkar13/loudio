#!/usr/bin/env bash
#
# Builds the `latest.json` manifest that tauri-plugin-updater reads.
#
# The updater does not install a .dmg or a bare .deb — it installs the updater
# artifacts the bundler emits alongside them (`.app.tar.gz` on macOS, the `.deb`
# on Linux), each paired with a `.sig` produced by the signing key. This script
# pairs every signature in the release directory with its artifact and emits one
# entry per platform target.
#
# Usage: compose-latest-json.sh <version> <dist-dir> <download-base-url>
#
# A missing signature is fatal rather than skipped: a manifest that silently
# omits a platform strands every user on it with no update and no error.

set -euo pipefail

VERSION="${1:?version required}"
DIST="${2:?dist directory required}"
BASE_URL="${3:?download base url required}"

if [ ! -d "$DIST" ]; then
	echo "::error::Dist directory '$DIST' does not exist." >&2
	exit 1
fi

# Maps an artifact filename to the platform key the updater looks up. The keys
# are dictated by the plugin (`{os}-{arch}`), not chosen here.
platform_for() {
	local name="$1"
	case "$name" in
	*aarch64.app.tar.gz | *arm64.app.tar.gz) echo "darwin-aarch64" ;;
	*x64.app.tar.gz | *x86_64.app.tar.gz) echo "darwin-x86_64" ;;
	*.app.tar.gz) echo "darwin-aarch64" ;;
	*arm64.deb | *aarch64.deb) echo "linux-aarch64" ;;
	*amd64.deb | *x86_64.deb) echo "linux-x86_64" ;;
	*) echo "" ;;
	esac
}

entries=""
count=0

shopt -s nullglob
for sig in "$DIST"/*.sig; do
	artifact="${sig%.sig}"
	base="$(basename "$artifact")"

	if [ ! -f "$artifact" ]; then
		echo "::error::Signature '$sig' has no matching artifact." >&2
		exit 1
	fi

	platform="$(platform_for "$base")"
	if [ -z "$platform" ]; then
		echo "::warning::Skipping '$base' — no updater platform maps to it."
		continue
	fi

	signature="$(tr -d '\n' <"$sig")"
	if [ -z "$signature" ]; then
		echo "::error::Signature file '$sig' is empty." >&2
		exit 1
	fi

	[ -n "$entries" ] && entries="${entries},"
	entries="${entries}
    \"${platform}\": {
      \"signature\": \"${signature}\",
      \"url\": \"${BASE_URL}/${base}\"
    }"
	count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
	echo "::error::No updater artifacts found in '$DIST'." >&2
	echo "::error::Check that bundle.createUpdaterArtifacts is true and that" >&2
	echo "::error::TAURI_SIGNING_PRIVATE_KEY was set during the build." >&2
	exit 1
fi

# `pub_date` must be RFC 3339; the updater rejects anything else.
cat <<EOF
{
  "version": "${VERSION}",
  "notes": "See the release notes at ${BASE_URL}",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {${entries}
  }
}
EOF
