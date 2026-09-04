# v1.0.7 — Stable Release

Updating Loudio no longer costs you the microphone.

## What's Changed

### 🐛 Fixed Bugs & Issues

- **Updating on macOS silently revoked microphone access.** macOS pins a privacy
  permission to the app's *designated requirement* — a rule the app has to keep
  satisfying for the grant to hold. Loudio's builds were ad-hoc signed, which
  gives `codesign` nothing to name but the code's own hash, so every new build
  failed the rule the permission had been granted under. macOS then refused
  capture outright rather than asking again, which is why access vanished after
  an update with no dialog to explain it.

  Builds now carry a stable certificate, and the requirement names that
  certificate instead of the code. It does not change between releases, so the
  permission survives. The release pipeline checks this on every build and fails
  rather than publish one that would regress it.

- **A microphone check made while Loudio was in the background could hang for
  close to a minute.** A capture request with the window off screen does not
  fail — it waits until the window is shown. One in the diagnostic log took
  45.5 seconds, against a fifth of a second for every request made with the
  window visible. The check that runs at startup now waits for the window
  instead, which matters most right after an update, when Loudio relaunches
  into the background.

### ⚠️ One-time step when updating

Old permission records were written against the previous, unsigned builds, and
macOS will not re-prompt while they exist. Clear them once:

```bash
tccutil reset Microphone io.github.sudsarkar13.loudio
```

Then relaunch Loudio and allow access when asked. This should not be needed
again.

### 🧹 Changed

- The certificate is self-signed, which is free and keeps Loudio free to build
  and distribute. It fixes the permission problem but not Gatekeeper: first
  launch still needs right-click → **Open**. Removing that warning requires a
  paid Apple Developer ID certificate, which the pipeline is already wired for
  should that ever change.
