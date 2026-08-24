# Store screenshots

These PNGs are what GNOME Software, KDE Discover and the Ubuntu App Center show
on Loudio's page. They are **not** packaged into the `.deb` — stores download
them over HTTP from `raw.githubusercontent.com`, so they only need to be
committed to `main` and pushed.

## What to add

Drop five PNGs here with these exact filenames. The names and captions are
already wired up in
[`src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml`](../../src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml)
— add the files and they appear, no config change needed.

| Filename | Caption already set | What to capture |
| :-- | :-- | :-- |
| `01-main-window.png` | Transcribing a microphone recording in the main window | The default view with a finished transcript on screen |
| `02-recording.png` | Recording from a selected microphone | Mid-recording, with the mic selector visible |
| `03-settings.png` | Choosing a local runtime profile, language and output options | The settings panel open |
| `04-history.png` | Reviewing and replaying earlier recordings | The recording history view with a few entries |
| `05-readiness.png` | The system readiness wizard checking local dependencies | The readiness wizard mid-check |

`01-main-window.png` is marked `type="default"` and is the one used as the
primary thumbnail, so make it the most representative shot.

## Requirements

- **Format:** PNG.
- **Size:** between 620x351 and 3840x2160. Aim for **1600x900 or 1920x1080**.
- **Aspect ratio:** keep all five consistent — 16:9 is ideal. Stores letterbox
  anything that disagrees, which looks untidy in the carousel.
- **Content:** window only, no desktop background or window shadow if you can
  avoid it. Use real transcripts rather than lorem ipsum, and avoid anything
  personal in the audio history — these are public.
- **Theme:** either is fine, but be consistent across all five.

On Ubuntu, `Alt`+`PrtSc` captures the focused window without the desktop behind it.

## After adding them

```bash
git add docs/screenshots/*.png
git commit -m "docs: add store screenshots for AppStream metadata"
git push origin main
```

Then confirm each URL resolves before cutting a release — a 404 shows as a blank
slot in the store:

```bash
for n in 01-main-window 02-recording 03-settings 04-history 05-readiness; do
  url="https://raw.githubusercontent.com/sudsarkar13/loudio/main/docs/screenshots/$n.png"
  printf '%-18s %s\n' "$n" "$(curl -s -o /dev/null -w '%{http_code}' "$url")"
done
```

All five should print `200`. Screenshots must be on `main` **before** the
release is published, because stores fetch them from the `main` branch URL.

## Validating the metadata

```bash
appstreamcli validate --pedantic src-tauri/appstream/io.github.sudsarkar13.loudio.metainfo.xml
```
