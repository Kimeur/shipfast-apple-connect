# Signing

## The API key

- One **Team key** (App Store Connect › Users and Access › Integrations › App Store Connect API) with the **App Manager** role covers everything here: apps, products, prices, builds, certificates, profiles. Admin works too.
- The `.p8` downloads once. Keep it in `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` (where `altool` looks) with mode 600.
- The scripts read `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH`, or `ascKey` in `ship/ship.local.json`. Never in `ship.config.json`, never in a commit, never echoed.
- Calls use a 15-minute ES256 JWT (`lib/asc.mjs`). `node S/lib/asc.mjs GET /v1/apps` is a quick read-only test; writes through it need `--yes`.

## What signing.mjs makes

| Step | API | Lands in |
|---|---|---|
| Bundle IDs, app and each extension | `POST /v1/bundleIds` | App Store Connect |
| Capabilities with no settings (`targets[].capabilities`) | `POST /v1/bundleIdCapabilities` | App Store Connect |
| Apple Distribution certificate (`--create-cert`) | `POST /v1/certificates` with a CSR made by `openssl` | `build/sign/dist.key`, `dist.cer` |
| `.p12` and a keychain used only for builds | `openssl pkcs12`, `security` | `build/sign/dist.p12`, `signing.keychain-db`, `keychain.pass` |
| App Store profile per target | `POST /v1/profiles` (`IOS_APP_STORE`) | `build/sign/<bundleId>.mobileprovision` |

`build/sign/` is mode 700 and gitignored. Losing it is fine: profiles can be downloaded again, and a certificate can be recreated. Leaking it is not: revoke the certificate on the web.

## Certificates

- An account holds only a few distribution certificates. Reuse one across apps when you can: copy its `dist.cer` and `dist.key` into the new app's `build/sign/` and run `signing.mjs`. It matches the local certificate to Apple's list by serial number.
- `--create-cert` makes a new one. Ask the owner first.
- A certificate is valid for one year. Profiles signed with it stop working when it expires; make a new certificate, then rerun `signing.mjs` (it creates new profiles for the new certificate).

## Capabilities

App Groups, iCloud containers and Associated Domains need identifiers or settings the API may not create; set them on the web (Certificates, Identifiers & Profiles) before `signing.mjs --only=profiles` (unverified through the API). Push notifications and in-app purchase need no settings.

## How build-upload.sh signs

1. Installs each `build/sign/<bundleId>.mobileprovision` under its UUID in `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`.
2. Adds `build/sign/signing.keychain-db` to the keychain search list, unlocks it, and restores the original list on exit.
3. Archives with `CODE_SIGNING_ALLOWED=NO` (a Swift package target refuses a forced profile).
4. Exports with `ExportOptions.plist`: `method app-store-connect`, `signingStyle manual`, `signingCertificate Apple Distribution`, one profile name per bundle ID from `targets`.
5. Uploads with `xcrun altool --upload-app --apiKey <id> --apiIssuer <issuer>`.
