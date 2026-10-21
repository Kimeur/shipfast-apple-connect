---
name: shipfast
description: "Takes any iOS app (iPhone, iPad, universal, or the foldable iPhone Duo) from 'the code builds' to 'submitted to App Review' with the App Store Connect API: bundle IDs, the distribution certificate and App Store profiles, availability and price, age rating and categories, the listing in every language, in-app purchases and subscriptions with prices and a free trial, RevenueCat, store screenshots for iPhone, iPad and iPhone Duo (APP_IPHONE_DUO), the product page header, the archive and upload, and the submission. Use when asked to ship, release, publish or submit an iOS app, set up App Store Connect, upload a build or screenshots, create products or subscriptions, or check what is missing before review. Every script reads ship.config.json, runs with --dry, and never sets prices or submits without the owner's go-ahead. Says which steps only the owner can do on the web (app record, Paid Apps agreement, App Privacy Publish, first products' Add for Review)."
metadata:
  verified: "Xcode 27.1 (27A9275), App Store Connect API as used for Fold Days (submitted 21 Oct 2026) and Duo Peas (submitted 18 Oct 2026), device: no"
  sources: "https://github.com/Kimeur/shipfast-apple-connect/blob/main/plugins/shipfast-apple-connect/skills/shipfast/references/sources.md"
---

# shipfast

A release pipeline in scripts for any iOS app, taken from two apps that shipped with it. It covers what happens after the app works: App Store Connect, signing, the listing, products, screenshots, the upload and the submission. iPad and iPhone Duo screenshots are optional: a device with no frames is skipped.

For iPhone Duo apps, the [Duology](https://github.com/Kimeur/duology) skills check layout and the fold before you ship (step 1).

## Rules

- **Ask the owner before anything outward-facing or hard to undo.** That means: creating a certificate (`--create-cert`), setting any price or trial (`--confirm-prices`), submitting (`--submit`), uploading a build, and every web step. Show the `--dry` output first.
- **Never set prices on your own.** Prices live in `ship/listing.mjs`; the owner approves them. Without `--confirm-prices` the scripts print what they would set and list it as pending.
- **Never submit the app without its products.** Reviewers would see a paywall with no prices. `submit.mjs` refuses when a product in the listing is missing or can't be attached.
- **Never put secrets in files that go to git.** The API key comes from the environment or `ship/ship.local.json` (gitignored). Signing files live in `build/sign/` (gitignored). Never print a key, a password or a `.p12`. Never paste credentials into a web form for the owner: point them to the field.
- **Never click App Privacy › Publish, accept an agreement, or enter bank or tax details.** Those are the owner's own declarations.
- **Use the existing simulators.** Find them by name ("iPhone 17", the iPad, "iPhone Duo"). Never create one: each takes 4-6 GB.
- **Build with the Xcode in `xcode.developerDir`** (default Xcode 27.1), passed as `DEVELOPER_DIR`. Never run `sudo` or `xcode-select`.
- **Re-run, don't patch by hand.** Every script reads first, creates what is missing, updates what differs and never deletes (except `screenshots.mjs --replace`). Fix the config and run it again.

## Run it

| Installed with | Scripts are in |
|---|---|
| The `shipfast-apple-connect` plugin in Claude Code | `"${CLAUDE_PLUGIN_ROOT}/skills/shipfast/scripts/"` |
| `npx skills add`, or copied by hand | `<skill-folder>/scripts/` (`${CLAUDE_SKILL_DIR}` in Claude Code) |

Below, `S` stands for that folder. Run every script from the app's folder: they find `ship/ship.config.json` by walking up from the current folder (or take `--config <path>`).

Needs: macOS, Xcode (27.1 or the one in `xcode.developerDir`), Node 20 or later, Python 3 with Pillow for the screenshot composers, an App Store Connect API key with the App Manager role (see [references/signing.md](references/signing.md#the-api-key)).

## The pipeline

Work through it in order. Each step names the script, what it needs, and the web step that blocks it, if any. The full checklist with every manual step is [references/manual-steps.md](references/manual-steps.md). Keep it ticked in the app's `TASKS.md`.

### 0. Set up and check

```bash
bash S/init.sh .                 # ship/ship.config.json, ship.local.json, listing.mjs, review-notes.txt, .gitignore lines
node S/doctor.mjs --offline      # config, listing limits, files; no network
node S/doctor.mjs                # adds what App Store Connect holds (reads only)
```

Fill `ship/ship.config.json` ([references/config.md](references/config.md)), put the API key and the App Review contact in `ship/ship.local.json`, and write the listing and review notes. `doctor.mjs` changes nothing; run it after every step.

### 1. Checks before anything ships

Run the app's own tests and look at it on each device it supports (`run-sim.sh`). For iPhone Duo apps, also run Duology's checks and fix what they find (they come from Duology, not from this skill):

```bash
duo-lint .                                   # zero errors before upload
duo-pose-matrix <bundle-id> -- -uiTesting    # closed, open, book, tabletop: read every frame
```

Then check by eye on the open phone that no button or text sits in the fold's reserved region. If Duology isn't installed, say so and offer to install it. Skip this paragraph for apps that don't target iPhone Duo.

### 2. Signing: bundle IDs, certificate, profiles

```bash
node S/signing.mjs --dry                 # what it would create
node S/signing.mjs --only=bundles        # register the app and extension bundle IDs
node S/signing.mjs --create-cert         # only with the owner's go-ahead, and only if build/sign/ has no certificate
```

It writes `build/sign/` (key, certificate, `.p12`, a keychain used only for builds, one `.mobileprovision` per target). Details and the certificate limit: [references/signing.md](references/signing.md).

### 3. The app record (web, owner)

The API cannot create an app. The owner creates it in App Store Connect › Apps › + (name, primary language, bundle ID, SKU). Then set `app.appId` in the config. Everything below needs it.

### 4. App settings

```bash
node S/app-setup.mjs --dry
node S/app-setup.mjs        # availability (every territory listed, exclusions closed), free price, age rating, categories, content rights
```

A paid app price needs `--confirm-prices`. The age rating answers are a declaration to Apple: read them with the owner (config `ageRating`).

### 5. Listing and products

```bash
node S/store-setup.mjs --dry
node S/store-setup.mjs                    # localizations, products, group, availability, version text, review info; prices pending
node S/store-setup.mjs --confirm-prices   # after the owner approved the prices in ship/listing.mjs
```

The owner must have an active Paid Apps agreement before products can go live. Product rules: [references/lessons.md](references/lessons.md#products-and-prices).

### 6. RevenueCat (if the app uses it)

Web steps with the owner, then one build setting. Follow [references/revenuecat.md](references/revenuecat.md). Never paste or type an In-App Purchase key: the owner picks the stored one.

### 7. Screenshots and header

```bash
bash S/run-sim.sh -uiTesting -demo                 # build for the simulator, run it, save a screenshot
python3 S/raw-shots.py iphone en                   # one run per device and language (iphone, ipad, ...)
python3 S/raw-shots.py duo-inner en --set-pose     # iPhone Duo apps only: --set-pose uses Duology's duo-pose
python3 S/store-screens.py                         # compose the frames
python3 S/store-header.py                          # product page header and search results asset
node S/screenshots.mjs --dry && node S/screenshots.mjs
node S/header.mjs --dry && node S/header.mjs
```

The icon must be a 1024 x 1024 PNG with no alpha channel: `python3 S/icon-check.py <icon-1024.png>` (`--fix` flattens it). To draw the icon from the app's own SwiftUI mark, start from `templates/IconRender.example.swift`.

Look at every frame before uploading. Sizes, display types and what is confirmed: [references/screenshots.md](references/screenshots.md). The app needs DEBUG launch arguments that open each screen with demo data (`capture.shots`).

### 8. Build and upload

```bash
bash S/build-upload.sh --no-upload    # archive and export only
bash S/build-upload.sh                # with the owner's go-ahead: uploads to App Store Connect
```

Archives unsigned, signs at export with the manual profiles, takes the next build number from App Store Connect, uploads with `altool`. Apple processes the build in about 10 minutes.

### 9. Check and submit

```bash
node S/submit.mjs                                    # attaches the newest VALID build, lists what is missing
node S/submit.mjs --submit --release=after-approval  # with the owner's go-ahead
```

Before `--submit`, the owner must have: published App Privacy, an active Paid Apps agreement, and, for the app's first products, clicked "Add for Review" on each product page and the subscription group page (the API refuses them with `FIRST_..._MUST_BE_SUBMITTED_ON_VERSION`). Then run `--submit --products-added-on-web`. A scheduled release takes whole hours only: `--release=2026-10-23T13:00:00Z`.

## When something fails

| Message | What to do |
|---|---|
| `No app record with bundle ID` | Step 3: the owner creates it on the web. |
| `App Store Connect key not set` / `API key file not found` | Set `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, or `ascKey` in `ship.local.json`. |
| `403` on every call | The key's role is too low (needs App Manager or Admin), or it was revoked. Ask the owner. |
| `no FRA price point at 4.50` | Apple has fixed price points. Pick one the API lists and ask the owner. |
| `FIRST_SUBSCRIPTION_MUST_BE_SUBMITTED_ON_VERSION` (or `_IAP_`, `_GROUP_`) | Web step: "Add for Review" on each product and the group, then `--products-added-on-web`. |
| Version `not editable` | It is in a draft submission or in review. Remove it from the draft on the web, or create the next version and pass `--version`. |
| Subscription stays `MISSING_METADATA` | Normal for a first subscription until it is submitted with a version. `submit.mjs` checks its parts itself. |
| Screenshot `wrong size` | Re-compose at a size from [references/screenshots.md](references/screenshots.md). |
| Archive fails on a package target's signing | Keep `CODE_SIGNING_ALLOWED=NO` on the archive; the export signs. |

## Report to the owner

End with what you ran, what changed in App Store Connect (ids and states), what is pending on them (the web steps, price approval, the submit go-ahead), and anything you couldn't confirm.
