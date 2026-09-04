#!/usr/bin/env bash
# Verifies every <screenshot> URL in the AppStream MetaInfo is reachable.
#
# Screenshots are NOT packaged — stores download them from the URLs below, so a
# missing file shows as a blank carousel on the store page. They must be pushed
# to the branch the URLs reference *before* a release is published.
#
# Usage: check-screenshots.sh [--warn-only]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
METAINFO="$ROOT/src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml"
WARN_ONLY=0
[ "${1:-}" = "--warn-only" ] && WARN_ONLY=1

# Read with a while-loop rather than `mapfile`: that is a bash 4 builtin, and
# macOS still ships bash 3.2 — so on a maintainer's Mac this script died before
# it checked a single URL, which defeats running the release checks locally.
URLS=()
while IFS= read -r line; do
  [ -n "$line" ] && URLS+=("$line")
done < <(python3 - "$METAINFO" <<'PYEOF'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for img in root.findall("screenshots/screenshot/image"):
    if img.text:
        print(img.text.strip())
PYEOF
)

if [ "${#URLS[@]:-0}" -eq 0 ]; then
  echo "::error::no screenshot URLs found in $METAINFO"
  exit 1
fi

missing=0
for url in "${URLS[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -L "$url" || echo 000)
  if [ "$code" = "200" ]; then
    printf '  %-4s %s\n' "$code" "$url"
  else
    printf '  %-4s %s   <-- NOT REACHABLE\n' "$code" "$url"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -eq 0 ]; then
  echo "All ${#URLS[@]} screenshots reachable."
  exit 0
fi

msg="$missing of ${#URLS[@]} screenshot URLs are unreachable — the store page will show blank slots. Add the PNGs under docs/screenshots/ and push them to main before releasing (see docs/screenshots/README.md)."
if [ "$WARN_ONLY" -eq 1 ]; then
  echo "::warning::$msg"
  exit 0
fi
echo "::error::$msg"
exit 1
