#!/usr/bin/env bash
#
# Assert that a built .dmg actually carries its Finder window layout.
#
# The layout — window size, icon size, and the app-on-the-left /
# Applications-on-the-right positions from `bundle.macOS.dmg` — lives entirely
# in a `.DS_Store` file at the root of the volume. `bundle_dmg.sh` writes it by
# driving Finder over AppleScript, and tauri-bundler skips that step whenever it
# sees `CI` set unless `TAURI_BUNDLER_DMG_IGNORE_CI` is also set. A skipped
# layout is not an error anywhere in the build: the .dmg is produced, published
# and installed normally, and only a human opening it sees Finder's default
# alphabetical arrangement instead of the drag-to-Applications window.
#
# v1.0.4 and v1.0.5 both shipped that way. This check exists so a flat .dmg
# fails the release rather than reaching the downloads page unnoticed.
#
# Usage: verify-dmg-layout.sh <directory containing .dmg files>

set -euo pipefail

DMG_DIR="${1:?usage: verify-dmg-layout.sh <bundle/dmg directory>}"

shopt -s nullglob
dmgs=("$DMG_DIR"/*.dmg)

if [ "${#dmgs[@]}" -eq 0 ]; then
	echo "::error::No .dmg files found in $DMG_DIR"
	exit 1
fi

status=0

for dmg in "${dmgs[@]}"; do
	echo "Checking $(basename "$dmg")"

	mount_dir="$(mktemp -d)"
	# The image embeds a licence agreement, so hdiutil waits on stdin for the
	# user to accept it. Without the `Y` the step hangs until the job times out.
	echo Y | hdiutil attach -readonly -nobrowse -noautoopen \
		-mountpoint "$mount_dir" "$dmg" >/dev/null

	if [ -f "$mount_dir/.DS_Store" ]; then
		echo "  window layout: present"
	else
		echo "::error::$(basename "$dmg") has no .DS_Store, so it opens with"
		echo "::error::Finder's default arrangement instead of the"
		echo "::error::drag-to-Applications window. Set"
		echo "::error::TAURI_BUNDLER_DMG_IGNORE_CI=true on the build step so"
		echo "::error::bundle_dmg.sh runs its Finder AppleScript on CI."
		status=1
	fi

	if [ -L "$mount_dir/Applications" ]; then
		echo "  Applications link: present"
	else
		echo "::error::$(basename "$dmg") has no /Applications symlink to drag onto."
		status=1
	fi

	hdiutil detach "$mount_dir" -quiet ||
		hdiutil detach "$mount_dir" -force -quiet
	rmdir "$mount_dir" 2>/dev/null || true
done

exit "$status"
