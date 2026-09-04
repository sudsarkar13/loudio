# Self-Signed Code Signing

Loudio's macOS builds are signed with a **self-signed certificate**. It costs
nothing, needs no Apple Developer account, and exists to solve exactly one
problem: keeping the microphone permission alive across updates.

For what a paid Developer ID certificate would add on top of this, see
[APPLE_SIGNING.md](APPLE_SIGNING.md).

---

## What this fixes, and what it does not

macOS records a privacy permission against the app's **designated
requirement** — a rule the app must satisfy for the grant to still apply.

With ad-hoc signing there is no certificate, so `codesign` has nothing to name
but the code itself:

```
# designated => cdhash H"54a9572d414ee150c6b6e2e7c54ae68cc7ea408b"
```

Every build produces different code, so every update fails that rule. TCC then
denies capture **without prompting**, because a record already exists — the
app simply stops hearing the microphone and no dialog explains why. That is
what happened between v1.0.4 and v1.0.5.

With a certificate, the requirement names the certificate instead:

```
# designated => identifier "io.github.sudsarkar13.loudio" and certificate leaf = H"..."
```

The certificate does not change between builds, so the grant survives.

| | Ad-hoc (before) | Self-signed (now) | Developer ID (USD 99/yr) |
| :-- | :-- | :-- | :-- |
| Microphone survives an update | ✗ | ✓ | ✓ |
| `codesign --verify` passes | ✓ | ✓ | ✓ |
| Gatekeeper opens it without a warning | ✗ | ✗ | ✓ |
| Can be notarized | ✗ | ✗ | ✓ |

**Gatekeeper is unchanged.** A self-signed certificate is not an Apple-issued
one, so first launch still needs right-click → **Open**. That is a deliberate
trade: it keeps Loudio free to build and distribute.

---

## The certificate

Generated once, on 2026-09-04, with tools already present on macOS. It lives in
`.tauri-keys/` (gitignored, never committed):

| File | What it is |
| :-- | :-- |
| `loudio-codesign.key` | Private key. **Losing this is the only thing that matters.** |
| `loudio-codesign.crt` | Public certificate. |
| `loudio-codesign.p12` | Both, bundled for import into a keychain. |
| `loudio-codesign.p12.password` | The `.p12` password. |
| `loudio-codesign.p12.base64` | What `APPLE_CERTIFICATE` holds. |

To recreate it (only if the key is lost — see *Rotation* below):

```bash
cd .tauri-keys

cat > codesign.cnf <<'CNF'
[req]
distinguished_name = dn
x509_extensions    = v3
prompt             = no

[dn]
CN = Loudio Code Signing
O  = Loudio
C  = IN

[v3]
basicConstraints     = critical,CA:false
keyUsage             = critical,digitalSignature
extendedKeyUsage     = critical,codeSigning
subjectKeyIdentifier = hash
CNF

# 20 years. The certificate's identity is what the permission is pinned to,
# so an expiry would silently reintroduce the problem it exists to prevent.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 7300 \
  -keyout loudio-codesign.key -out loudio-codesign.crt -config codesign.cnf

PW="$(openssl rand -base64 24)"
printf '%s' "$PW" > loudio-codesign.p12.password

# `-legacy` is required: macOS's Security framework cannot import a .p12 that
# OpenSSL 3 encrypted with its modern defaults.
openssl pkcs12 -export -legacy \
  -inkey loudio-codesign.key -in loudio-codesign.crt \
  -name "Loudio Code Signing" -out loudio-codesign.p12 -passout "pass:$PW"

base64 -i loudio-codesign.p12 -o loudio-codesign.p12.base64
chmod 600 loudio-codesign.p12*
```

**Back up `.tauri-keys/` somewhere off this machine**, alongside the updater
signing key. It is not in git by design.

---

## The GitHub secrets

```bash
gh secret set APPLE_CERTIFICATE          --repo sudsarkar13/loudio < .tauri-keys/loudio-codesign.p12.base64
gh secret set APPLE_CERTIFICATE_PASSWORD --repo sudsarkar13/loudio < .tauri-keys/loudio-codesign.p12.password
printf 'Loudio Code Signing' | gh secret set APPLE_SIGNING_IDENTITY --repo sudsarkar13/loudio
printf 'true'                | gh secret set APPLE_SIGNING_ENABLED  --repo sudsarkar13/loudio
```

Pipe them from the files rather than pasting. A pasted secret picks up wrapping
or a trailing newline, and the failure surfaces much later as an unrelated
error — the same trap that broke the v1.0.5 updater key.

`APPLE_SIGNING_IDENTITY` must match the certificate's common name **exactly**;
it is how `codesign` finds the key.

Notarization stays off: it is gated separately on `APPLE_ID`,
`APPLE_PASSWORD` and `APPLE_TEAM_ID`, none of which a self-signed certificate
can satisfy. The step skips cleanly.

---

## How the release job uses it

Two things differ from the Developer ID path, both in
[`release.yml`](../.github/workflows/release.yml):

1. **The certificate is imported by the workflow, not the bundler.** A
   self-signed certificate has no trust anchor, and `codesign` refuses an
   identity it cannot validate — reported as the thoroughly unhelpful
   `no identity found`, with the real reason (`CSSMERR_TP_NOT_TRUSTED`) visible
   only via `security find-identity -p codesigning`. So the job adds the
   certificate as a trusted code-signing root before building. This is needed
   **only on the machine doing the signing**; nobody running Loudio needs it,
   and the runner is destroyed when the job ends. The step detects a
   self-signed certificate by checking whether it is its own issuer, so a
   Developer ID certificate would skip it.

2. **The build asserts the requirement is certificate-based.** Falling back to
   ad-hoc would otherwise produce a perfectly valid release that quietly breaks
   microphone access for everyone who updates. The job fails instead.

---

## One-time reset for existing installs

Anyone already running an unsigned build has stale permission records that
cannot match the new signature. macOS will not re-prompt while they exist, so
they have to be cleared once:

```bash
tccutil reset Microphone io.github.sudsarkar13.loudio
```

Relaunch Loudio and allow access when asked. From that release onward, updates
keep the grant and this is not needed again.

---

## Rotation

Replacing the certificate resets every permission granted to the old one — the
same breakage this document exists to prevent. Only do it if the private key
leaks or is lost. Regenerate as above, update the two secrets, and tell users
to run the `tccutil reset` command once more.
