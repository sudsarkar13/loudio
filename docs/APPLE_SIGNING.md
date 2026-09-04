# Apple Code Signing & Notarization Setup

> **Status:** macOS builds are already signed, with a **free self-signed
> certificate** — see [SELF_SIGNED_CODESIGNING.md](SELF_SIGNED_CODESIGNING.md).
> That is what keeps the microphone permission alive across updates, and it is
> the setup currently in use.
>
> This document covers the paid **Developer ID** certificate, which adds the one
> thing a self-signed certificate cannot: Gatekeeper opening the app without a
> warning, and notarization. The macOS job in
> [`.github/workflows/release.yml`](../.github/workflows/release.yml) already
> contains the full signing + notarization pipeline as a **gated no-op** — each
> step checks for its secret and skips when absent — so adding the `APPLE_ID`,
> `APPLE_PASSWORD` and `APPLE_TEAM_ID` secrets is all that is needed to activate
> notarization once you enroll.

---

## Table of Contents

1. [Why this matters](#why-this-matters)
2. [Prerequisites](#prerequisites)
3. [Step 1 — Enroll in the Apple Developer Program](#step-1--enroll-in-the-apple-developer-program)
4. [Step 2 — Create a Developer ID Application certificate](#step-2--create-a-developer-id-application-certificate)
5. [Step 3 — Export the certificate as a `.p12`](#step-3--export-the-certificate-as-a-p12)
6. [Step 4 — Generate an app-specific password](#step-4--generate-an-app-specific-password)
7. [Step 5 — Collect the values you need](#step-5--collect-the-values-you-need)
8. [Step 6 — Add the secrets to your GitHub repository](#step-6--add-the-secrets-to-your-github-repository)
9. [Step 7 — Verify the workflow activates](#step-7--verify-the-workflow-activates)
10. [Troubleshooting](#troubleshooting)
11. [Cost & renewal](#cost--renewal)
12. [Security notes](#security-notes)

---

## Why this matters

A macOS `.dmg` built on GitHub Actions with **no signing** will:

- Trigger Gatekeeper's *"Loudio.app cannot be opened because the developer cannot be verified"* dialog on first launch.
- Require users to right-click → Open → confirm to bypass the warning.
- Fail to launch entirely on stricter macOS configurations.

A `.dmg` that is **signed but not notarized** will warn users but is still launchable. **Notarization** is what removes the warning for most users. **Stapling** the notarization ticket to the `.dmg` lets it launch fully offline.

The complete fix is: **sign** + **notarize** + **staple**. The workflow already does all three.

---

## Prerequisites

- An Apple ID (free). Use a personal Apple ID you control long-term.
- A macOS device (you need macOS to generate the Developer ID certificate — it cannot be created from Linux or Windows in any practical way).
- For paid enrollment: a credit card. Apple Developer Program is **USD 99/year** (or equivalent local currency).
- A registered legal entity (for an *Organization* account) **or** an individual (for a *Personal* account). Personal accounts can be upgraded to Organization later.

---

## Step 1 — Enroll in the Apple Developer Program

1. Visit https://developer.apple.com/programs/enroll/
2. Sign in with your Apple ID.
3. Choose **Individual** or **Organization**. Most solo developers choose Individual.
4. Follow the prompts. Apple will verify your identity (may take 24–48 hours for first-time enrollment).
5. Once approved, you'll have access to **App Store Connect**, **developer.apple.com/account**, and the **Certificates, Identifiers & Profiles** portal.

> ⏳ This step can take 1–2 days. Start it first, then continue with the cert creation in parallel *if you already have an existing account* (existing accounts can create Developer ID certs immediately without waiting).

---

## Step 2 — Create a Developer ID Application certificate

> ⚠️ **Important:** you want a **Developer ID Application** certificate, *not* a *Mac App Distribution* or *Apple Development* certificate. The Developer ID is specifically for software distributed **outside the Mac App Store** (e.g. via direct download of a `.dmg`).

### On macOS (Keychain Access)

1. Open **Keychain Access** (Applications → Utilities).
2. Menu: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**
3. Fill in:
   - **User Email Address:** your Apple ID email
   - **Common Name:** e.g. `Loudio CI Signing`
   - **Request is:** Saved to disk
4. Click **Continue**. A `.certSigningRequest` (CSR) file will be saved to your Desktop.

### In the Apple Developer portal

5. Open https://developer.apple.com/account/resources/certificates/list
6. Click the **+** button to create a new certificate.
7. Under **Software**, select **Developer ID Application** → click **Continue**.
8. Upload the `.certSigningRequest` you just generated.
9. Click **Continue**, then **Download**. A `developerID_application.cer` file is saved.
10. **Double-click** the downloaded `.cer` file. Keychain Access will import it. You should now see *"Developer ID Application: <Your Name>"* in the **My Certificates** tab of Keychain Access.

---

## Step 3 — Export the certificate as a `.p12`

The `.cer` alone is not portable — you need a `.p12` (PKCS#12) bundle that contains both the certificate and its private key.

1. Open **Keychain Access**.
2. Switch to the **My Certificates** tab.
3. Find *"Developer ID Application: <Your Name>"*.
4. Right-click → **Export "Developer ID Application: …"**.
5. Choose file format: **Personal Information Exchange (.p12)**.
6. Save it somewhere safe (e.g. `~/secure/loudio-ci.p12`).
7. Keychain will prompt for a password to protect the `.p12`. **Pick a strong password and store it in a password manager.** This is `APPLE_CERTIFICATE_PASSWORD`.
8. macOS will ask for your login password to authorize the export.

### Get the base64-encoded blob (this is what goes into GitHub)

GitHub Secrets store text, not binary files. The workflow decodes the base64 and reconstructs the `.p12` on the runner.

```bash
# Run this on the Mac where you exported the .p12
base64 -i ~/secure/loudio-ci.p12 | pbcopy
```

`pbcopy` puts the base64 string on your clipboard. Paste it into the `APPLE_CERTIFICATE` secret in Step 6.

> 🔒 **Do not** commit this base64 blob to git. Treat it like a private key.

---

## Step 4 — Generate an app-specific password

`notarytool` (Apple's modern notarization CLI) requires an **app-specific password** rather than your normal Apple ID password. Two-factor authentication must be enabled on the Apple ID.

1. Visit https://appleid.apple.com/account/manage
2. Sign in.
3. In the **Security** section, click **App-Specific Passwords** → **Generate an app-specific password**.
4. Label it e.g. `Loudio GitHub CI`.
5. Apple will show a one-time password like `abcd-efgh-ijkl-mnop`. **Copy it now** — you cannot view it again.

This is `APPLE_PASSWORD`.

---

## Step 5 — Collect the values you need

By the end of Steps 2–4 you should have:

| Variable | Example | Source |
|---|---|---|
| `APPLE_CERTIFICATE` | (long base64 string) | `base64 -i loudio-ci.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `p@ssw0rd-Strong!` | Password you set in Step 3 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID1234)` | Keychain Access, or run `security find-identity -v -p codesigning` |
| `APPLE_ID` | `you@example.com` | The Apple ID used for enrollment |
| `APPLE_PASSWORD` | `abcd-efgh-ijkl-mnop` | App-specific password from Step 4 |
| `APPLE_TEAM_ID` | `TEAMID1234` | developer.apple.com/account → Membership |

To find your **Team ID** and **signing identity** quickly:

- Team ID: https://developer.apple.com/account → top right of the page, under your name.
- Signing identity (exact string, including the `Developer ID Application:` prefix):

  ```bash
  security find-identity -v -p codesigning
  ```

---

## Step 6 — Add the secrets to your GitHub repository

1. Go to https://github.com/sudsarkar13/loudio/settings/secrets/actions
2. Click **New repository secret** for each of the six values:

   | Secret name | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | (base64 string from Step 3) |
   | `APPLE_CERTIFICATE_PASSWORD` | (password from Step 3) |
   | `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Name> (<TEAMID>)` |
   | `APPLE_ID` | (your Apple ID email) |
   | `APPLE_PASSWORD` | (app-specific password from Step 4) |
   | `APPLE_TEAM_ID` | (10-character team ID) |

3. Click **Add secret** for each.

That's it. No workflow file changes are required.

---

## Step 7 — Verify the workflow activates

The next time you push a `package.json` version bump to `main`, the `build-macos-dmg` job will:

1. **Skip** the code-signing step (line ~434) if `APPLE_CERTIFICATE` is **absent**.
2. **Run** the code-signing step if `APPLE_CERTIFICATE` is present.
3. **Skip** the notarization step (line ~461) unless **all three** of `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are present.
4. **Run** notarization + stapling when all three are present.

You can verify by:

- Pushing a version bump (e.g. `0.1.0` → `0.1.1`) to `main` and watching the Actions tab.
- Looking for the steps *Code-sign macOS bundle (gated — runs only when secrets are present)* and *Notarize macOS dmg (gated — runs only when notarization secrets are present)* — they should show a green checkmark.

If something fails, the most common cause is a **mismatched signing identity** (must include the full `Developer ID Application: …` string, not just the bare name).

---

## Troubleshooting

### `notarytool` returns `Invalid credentials`

- Confirm your app-specific password is correct and has not been revoked.
- Confirm two-factor authentication is enabled on the Apple ID.
- Re-generate a new app-specific password and update the `APPLE_PASSWORD` secret.

### `security import` fails with `The specified item could not be found in the keychain`

- Your base64 blob may be corrupt. Re-export and re-encode.
- Verify the password is correct. Re-export if necessary.

### The build succeeds but the `.dmg` is still flagged by Gatekeeper

- Confirm notarization **and** stapling both ran. Check the Actions logs.
- Run `xcrun stapler validate path/to/Loudio.dmg` locally to verify the ticket.
- Run `spctl -a -t install -v path/to/Loudio.app` to inspect Gatekeeper's assessment.

### `Error: failed to sign` during `tauri build`

- The signing identity is wrong. Confirm the exact string with `security find-identity -v -p codesigning`.
- The cert may have expired (Developer ID certs are valid for 5 years). Re-create.

### `apt-get` failures on Ubuntu (unrelated but adjacent)

The Ubuntu build job installs `libwebkit2gtk-4.1-dev` and friends. If the runner image upgrades and breaks, the Linux install step will fail. The macOS job is unaffected.

---

## Cost & renewal

- **Apple Developer Program:** USD 99/year (auto-renews). Renews automatically if you have a payment method on file.
- **Developer ID certificates:** valid for 5 years. Must be re-created before expiry.
- **Notarization:** free, but subject to Apple's service limits (typically a few hundred submissions/hour; CI is far below that).
- **App-specific passwords:** can be revoked and re-issued any time. They survive Apple ID password changes.

Set a calendar reminder ~1 month before both the Apple Developer Program renewal date and the certificate's 5-year expiry.

---

## Security notes

1. **Rotate the `.p12` password** if you suspect it's been compromised. Generate a new `.p12` (same cert, new password) and re-upload the base64 + the new password.
2. **Rotate the app-specific password** if the Apple ID itself is compromised, or as a periodic hygiene measure.
3. **Limit repo access** to trusted maintainers. Anyone with write access to the repo can read all secrets in Actions logs *and* via the secrets UI.
4. **Consider storing the `.p12` in GitHub's encrypted secrets** (which you are) **rather than** a long-lived artifact in a third-party vault. GitHub encrypts secrets at rest with KMS keys and only exposes them to workflows on a per-run basis.
5. **Do not echo the base64 or the app-specific password** in any workflow step output. The current workflow uses `set -euo pipefail` and `>> "$GITHUB_OUTPUT"` only for non-sensitive values, but be cautious when extending the workflow.

---

## Further reading

- Apple — [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- Apple — [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing_the_notarization_workflow)
- Tauri — [macOS code signing & notarization](https://v2.tauri.app/distribute/sign/macos/)
- GitHub — [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
