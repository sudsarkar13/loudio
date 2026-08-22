#!/usr/bin/env python3
"""Assert the AppStream fields that app stores actually render.

`appstreamcli validate` accepts a MetaInfo file with no <project_license> — the
exact omission that made Loudio show "Unknown License" in GNOME Software. These
checks cover the fields a user sees on the store page, plus the two identifiers
that must agree with tauri.conf.json for the metadata to bind to the app at all.

Usage: check_metainfo_fields.py <metainfo.xml> <tauri.conf.json>
"""

import json
import sys
import xml.etree.ElementTree as ET

REQUIRED_TEXT = [
    ("id", "stores cannot identify the app"),
    ("name", "the store falls back to the lowercase package name"),
    ("summary", "no one-line description is shown"),
    ("metadata_license", "required by the AppStream spec"),
    ("project_license", 'the store shows "Unknown License"'),
]


def main(metainfo_path: str, conf_path: str) -> int:
    root = ET.parse(metainfo_path).getroot()
    conf = json.load(open(conf_path))
    problems = []

    for tag, why in REQUIRED_TEXT:
        if not (root.findtext(tag) or "").strip():
            problems.append(f"<{tag}> is missing or empty — {why}")

    # Accept either spelling: <developer><name> is the AppStream 1.0 form, while
    # <developer_name> is what AppStream 0.15 on Ubuntu 22.04 understands.
    if root.find("developer/name") is None and root.find("developer_name") is None:
        problems.append(
            "neither <developer><name> nor <developer_name> is set "
            "— no publisher is shown"
        )
    if not root.findall("description/p"):
        problems.append("<description> has no paragraphs — no detail text is shown")
    if not root.findall("screenshots/screenshot"):
        problems.append("no <screenshot> entries — the store shows an empty carousel")
    if not root.findall("releases/release"):
        problems.append(
            'no <release> entries — the store shows "No details for this release"'
        )

    # The component id must equal the bundle identifier, and the launchable must
    # name the desktop file Tauri actually generates (from productName). If
    # either drifts, the store shows a package with no metadata attached.
    identifier = conf["identifier"]
    component_id = (root.findtext("id") or "").strip()
    if component_id != identifier:
        problems.append(
            f'<id> is "{component_id}" but tauri.conf.json identifier is "{identifier}"'
        )

    expected_desktop = f'{conf["productName"]}.desktop'
    launchable = (root.findtext("launchable") or "").strip()
    if launchable != expected_desktop:
        problems.append(
            f'<launchable> is "{launchable}" but Tauri generates '
            f'"{expected_desktop}" — the store will not bind metadata to the app'
        )

    for line in problems:
        print(f"::error::{metainfo_path}: {line}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
