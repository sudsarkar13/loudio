#!/usr/bin/env bash
# Validates the Linux packaging metadata that app stores read.
#
# Catches, before a release is cut:
#   - a malformed or non-conformant AppStream MetaInfo file
#   - a desktop entry template that renders to something invalid
#   - bundle.icon or deb.files entries pointing at files that do not exist
#
# Requires: appstreamcli, desktop-file-validate, python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CONF="src-tauri/tauri.conf.json"
METAINFO="src-tauri/appstream/com.loudio.desktop.metainfo.xml"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '::error::%s\n' "$*"; fail=1; }

say "== AppStream MetaInfo =="
if [ ! -f "$METAINFO" ]; then
  bad "missing $METAINFO — stores will show no name, description or licence"
else
  if appstreamcli validate --no-net --pedantic "$METAINFO"; then
    say "  ok  $METAINFO"
  else
    bad "$METAINFO failed AppStream validation"
  fi

  # appstreamcli passes a file with no <project_license> — the exact field that
  # made stores show "Unknown License". Assert the store-visible fields directly.
  if python3 "$ROOT/.github/scripts/check_metainfo_fields.py" "$METAINFO" "$CONF"; then
    say "  ok  required store fields present and consistent with $CONF"
  else
    fail=1
  fi
fi

say ""
say "== Desktop entry template =="
TEMPLATE=$(python3 -c "
import json;d=json.load(open('$CONF'))
print(d['bundle'].get('linux',{}).get('deb',{}).get('desktopTemplate',''))")

if [ -z "$TEMPLATE" ]; then
  say "  no desktopTemplate configured; Tauri will generate a default"
else
  SRC="src-tauri/$TEMPLATE"
  if [ ! -f "$SRC" ]; then
    bad "desktopTemplate points at $SRC which does not exist"
  else
    # Render the Handlebars template the way Tauri does, then validate the
    # result — an invalid entry only shows up once it is on a user's machine.
    RENDERED="$(mktemp -d)/rendered.desktop"
    python3 - "$CONF" "$SRC" "$RENDERED" <<'PY'
import json, re, sys
conf, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(conf))
name = d["productName"]
exe = name.lower()
comment = d["bundle"].get("shortDescription", "")
t = open(src).read()
# {{#if comment}}…{{/if}} — comment is always set here, so keep the body.
t = re.sub(r"\{\{#if comment\}\}", "", t)
t = re.sub(r"\{\{/if\}\}", "", t)
t = (t.replace("{{name}}", name)
      .replace("{{comment}}", comment)
      .replace("{{exec}}", exe)
      .replace("{{icon}}", exe)
      .replace("{{categories}}", ""))
open(out, "w").write(t)
PY
    # desktop-file-validate exits 0 on hints, but a hint here is a real defect:
    # two main categories means the app is listed twice in the menu.
    OUT=$(desktop-file-validate "$RENDERED" 2>&1 || true)
    if [ -n "$OUT" ]; then
      printf '%s\n' "$OUT" | sed "s|$RENDERED|$SRC|"
      bad "$SRC renders to a desktop entry with errors or hints"
    else
      say "  ok  $SRC renders to a clean desktop entry"
    fi
  fi
fi

say ""
say "== Referenced files exist =="
while IFS=$'\t' read -r kind path; do
  [ -z "${path:-}" ] && continue
  if [ -f "src-tauri/$path" ]; then
    say "  ok  $kind  $path"
  else
    bad "$kind references src-tauri/$path which does not exist"
  fi
done < <(python3 -c "
import json
d=json.load(open('$CONF'))['bundle']
for i in d.get('icon',[]):
    print('icon\t'+i)
for fmt in ('deb','appimage','rpm'):
    for dest,src in d.get('linux',{}).get(fmt,{}).get('files',{}).items():
        print(fmt+'.files\t'+src)
")

say ""
if [ "$fail" -ne 0 ]; then
  say "Packaging metadata validation FAILED"
  exit 1
fi
say "Packaging metadata validation passed"
