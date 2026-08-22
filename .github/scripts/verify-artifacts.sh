#!/usr/bin/env bash
# Asserts that every bundle in the given directories carries the expected
# version in its filename, and that each directory produced at least one file.
#
# Usage: verify-artifacts.sh <version> <dir> [<dir>...]
set -euo pipefail
shopt -s nullglob

EXPECTED="${1:?expected version required}"
shift

# Tauri sanitises prerelease separators for some bundle formats (a Debian
# version cannot contain a bare '-'), so match the numeric core as well.
CORE="${EXPECTED%%-*}"

total=0
for dir in "$@"; do
  # Match release artifacts by extension. Tauri leaves other things beside the
  # real output — bundle_dmg.sh in bundle/dmg, and a temporary rw.*.dmg while
  # converting — and treating every file in the directory as an artifact made
  # the macOS builds fail on bundle_dmg.sh, which carries no version.
  files=("$dir"/*.dmg "$dir"/*.deb "$dir"/*.AppImage)
  if [ "${#files[@]}" -eq 0 ]; then
    echo "::error::No artifacts produced in $dir"
    exit 1
  fi

  for file in "${files[@]}"; do
    base="$(basename "$file")"

    # Tauri's intermediate read-write image, if bundling left one behind.
    case "$base" in
      rw.*.dmg) continue ;;
    esac
    if [[ "$base" != *"$EXPECTED"* && "$base" != *"$CORE"* ]]; then
      echo "::error::$base does not carry version $EXPECTED"
      exit 1
    fi
    printf '  ok  %s\n' "$base"
    total=$((total + 1))
  done
done

echo "Verified $total artifact(s) at version $EXPECTED"
