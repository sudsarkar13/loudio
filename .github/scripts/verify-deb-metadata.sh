#!/usr/bin/env bash
# Inspects a built .deb and asserts the store metadata actually made it in.
#
# Guards against a silent regression: if bundle.linux.deb.files is dropped or
# the desktopTemplate path breaks, Tauri still produces a working package — it
# just goes back to appearing as "loudio" with a "(none)" description.
#
# Usage: verify-deb-metadata.sh <path-to-deb>
set -euo pipefail

DEB="${1:?path to .deb required}"
[ -f "$DEB" ] || { echo "::error::no such file: $DEB"; exit 1; }

fail=0
bad() { printf '::error::%s\n' "$*"; fail=1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
dpkg-deb -x "$DEB" "$WORK"

echo "== $(basename "$DEB") =="

# --- control fields the store falls back to -------------------------------
CONTROL="$(dpkg-deb -I "$DEB" control)"
desc_long=$(printf '%s\n' "$CONTROL" | sed -n '/^Description:/,$p' | tail -n +2)
case "$desc_long" in
  *"(none)"*|"") bad "control Description has no body — set bundle.longDescription" ;;
  *) echo "  ok  control Description has a body" ;;
esac
printf '%s\n' "$CONTROL" | grep -q '^Homepage:' \
  && echo "  ok  control Homepage present" || bad "control has no Homepage field"
printf '%s\n' "$CONTROL" | grep -q '^Section:' \
  && echo "  ok  control Section present" || bad "control has no Section field"

# --- AppStream MetaInfo ----------------------------------------------------
META=$(find "$WORK/usr/share/metainfo" -name '*.metainfo.xml' 2>/dev/null | head -1 || true)
if [ -z "$META" ]; then
  bad "no AppStream MetaInfo in /usr/share/metainfo — stores show no name, description, licence or screenshots"
else
  echo "  ok  MetaInfo packaged at ${META#$WORK}"
  appstreamcli validate --no-net "$META" >/dev/null 2>&1 \
    && echo "  ok  packaged MetaInfo validates" \
    || bad "packaged MetaInfo failed validation"
fi

# --- desktop entry ---------------------------------------------------------
DESK=$(find "$WORK/usr/share/applications" -name '*.desktop' 2>/dev/null | head -1 || true)
if [ -z "$DESK" ]; then
  bad "no .desktop file packaged"
else
  echo "  ok  desktop entry packaged at ${DESK#$WORK}"
  OUT=$(desktop-file-validate "$DESK" 2>&1 || true)
  [ -z "$OUT" ] && echo "  ok  packaged desktop entry is clean" \
                || { printf '%s\n' "$OUT"; bad "packaged desktop entry has errors or hints"; }
  grep -q '^Categories=..*' "$DESK" \
    && echo "  ok  Categories is populated" \
    || bad "Categories is empty — the app will not appear under any menu section"

  # The MetaInfo only binds to the app if launchable names this exact file.
  if [ -n "${META:-}" ]; then
    want=$(python3 -c "
import sys,xml.etree.ElementTree as ET
print((ET.parse('$META').getroot().findtext('launchable') or '').strip())")
    got=$(basename "$DESK")
    [ "$want" = "$got" ] \
      && echo "  ok  launchable '$want' matches the packaged desktop file" \
      || bad "MetaInfo launchable is '$want' but the package ships '$got'"
  fi
fi

# --- copyright -------------------------------------------------------------
# Debian policy requires /usr/share/doc/<pkg>/copyright. Tauri's licenseFile
# setting does not produce one, so the package shipped with no licence text.
COPY=$(find "$WORK/usr/share/doc" -name 'copyright' 2>/dev/null | head -1 || true)
if [ -z "$COPY" ]; then
  bad "no /usr/share/doc/<pkg>/copyright — required by Debian policy"
else
  echo "  ok  copyright packaged at ${COPY#$WORK}"
  head -1 "$COPY" | grep -q '^Format: https://www.debian.org/doc/packaging-manuals/copyright-format' \
    && echo "  ok  copyright is machine-readable (DEP-5)" \
    || bad "copyright is not in DEP-5 format"
fi

# --- icons -----------------------------------------------------------------
count=$(find "$WORK/usr/share/icons" -name '*.png' 2>/dev/null | wc -l || echo 0)
[ "$count" -ge 3 ] && echo "  ok  $count icon sizes packaged" \
                   || bad "only $count icon sizes packaged"
(find "$WORK/usr/share/icons" -path '*64x64*' -name '*.png' -print -quit 2>/dev/null || true) | grep -q . \
  && echo "  ok  64x64 icon present (the size stores prefer)" \
  || bad "no 64x64 icon — stores commonly fall back to a generic package icon"

[ "$fail" -eq 0 ] && echo "Package metadata OK" || echo "Package metadata FAILED"
exit "$fail"
