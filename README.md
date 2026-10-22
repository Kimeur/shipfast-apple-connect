# shipfast-apple-connect

### Ship any iOS app from "it builds" to "submitted to App Review", with Claude Code and the App Store Connect API.

A Claude Code plugin with one skill, `shipfast`, and one command, `/shipfast`. Small Node scripts drive the App Store Connect API: signing, availability, the listing in every language, in-app purchases and subscriptions, RevenueCat, store screenshots, the upload and the submission. It works for iPhone, iPad and universal apps, and for the foldable iPhone Duo.

It is the release pipeline of two apps that shipped with it (Duo Peas, submitted 18 October 2026, and Fold Days, submitted 21 October 2026), with every app-specific value moved into a config file.

> [!NOTE]
> Community project. Not affiliated with, endorsed by or sponsored by Apple Inc. or RevenueCat. App Store, iPhone and iPad are trademarks of Apple Inc.

## What it does, and what it won't

| The agent does | Only you do |
|---|---|
| Registers bundle IDs, makes App Store profiles (and a distribution certificate when you say so) | Create the app record in App Store Connect (the API can't) |
| Sets availability, the free price, age rating, categories, content rights | Approve every price before it is set |
| Writes the listing, products, subscription group, localizations, review notes | Keep the Paid Apps agreement active |
| Prices products in every territory and adds the free trial, with `--confirm-prices` | Publish App Privacy (your attestation) |
| Captures, composes and uploads screenshots for iPhone, iPad and iPhone Duo, plus the product page header | Pick the stored In-App Purchase key in RevenueCat; paste the server notification URLs |
| Archives, signs, uploads, attaches the build, checks what is missing | Click "Add for Review" on the app's first products (the API refuses them) |
| Submits, with `--submit`, once you said go | Say go |

Hard rules in the skill: no prices without `--confirm-prices`, no submission without the app's products, no secrets in tracked files, `--dry` on every script, never a new simulator.

## Quick start

**You need:** a Mac with Xcode, Node 20 or later, Python 3 with Pillow (for screenshots), Claude Code, and an App Store Connect API key with the App Manager role.

```bash
/plugin marketplace add Kimeur/shipfast-apple-connect
/plugin install shipfast-apple-connect@shipfast-apple-connect
```

Then, in your app's folder:

```text
Set up shipfast for this app and tell me what is missing before App Review.
```

Claude copies the templates into `ship/`, fills what it can from the Xcode project, and runs the read-only doctor. Check where you stand at any time:

```text
/shipfast
```

<details>
<summary><strong>Cursor, Codex and other agents</strong></summary>

```bash
npx skills add Kimeur/shipfast-apple-connect
```

Or copy `plugins/shipfast-apple-connect/skills/shipfast/` anywhere. Then from your app's folder:

```bash
bash <skill>/scripts/init.sh .
node <skill>/scripts/doctor.mjs --offline
```

Read `<skill>/SKILL.md` for the order of the steps. Every script prints its usage at the top of the file.

</details>

## The pipeline

| Step | Script | Owner step that blocks it |
|---|---|---|
| Set up and check | `init.sh`, `doctor.mjs` | API key |
| App checks | your tests, `run-sim.sh` (iPhone Duo apps: Duology's `duo-lint`, `duo-pose-matrix`) | |
| Bundle IDs, certificate, profiles | `signing.mjs` | OK for a new certificate |
| App record | | Create it on the web |
| Availability, price, age, categories | `app-setup.mjs` | Age rating answers |
| Listing, products, prices, review info | `store-setup.mjs` | Price approval, Paid Apps agreement |
| RevenueCat | [references/revenuecat.md](plugins/shipfast-apple-connect/skills/shipfast/references/revenuecat.md) | Key choice, notification URLs |
| Icon, screenshots and header | `icon-check.py`, `raw-shots.py`, `store-screens.py`, `store-header.py`, `screenshots.mjs`, `header.mjs` | |
| Build and upload | `build-upload.sh` | Go-ahead |
| Check and submit | `submit.mjs` | App Privacy Publish, first products' Add for Review, go-ahead |

The full checklist, with every manual step in order: [references/manual-steps.md](plugins/shipfast-apple-connect/skills/shipfast/references/manual-steps.md).

## Devices

| App runs on | Screenshot sets | Config |
|---|---|---|
| iPhone | iPhone 6.9" (`APP_IPHONE_67`) | default |
| iPhone and iPad | adds iPad 13" (`APP_IPAD_PRO_3GEN_129`) | add it to `submit.requiredScreenshots` |
| iPhone Duo (foldable) | adds iPhone Duo (`APP_IPHONE_DUO`), open and closed | keep the `duo-*` capture devices; see [Duology](https://github.com/Kimeur/duology) for design and fold checks |

A device with no frames is skipped, so the same scripts serve every case. Sizes and what is confirmed: [references/screenshots.md](plugins/shipfast-apple-connect/skills/shipfast/references/screenshots.md).

## Config

One file per app, `ship/ship.config.json`, plus `ship/ship.local.json` (gitignored) for the API key and the App Review contact. The listing lives in `ship/listing.mjs`. Templates are in [`templates/`](plugins/shipfast-apple-connect/skills/shipfast/templates/); every key is in [references/config.md](plugins/shipfast-apple-connect/skills/shipfast/references/config.md).

```json
{
  "app": { "name": "My App", "bundleId": "com.example.myapp", "appId": null },
  "team": { "teamId": "REPLACE_ME" },
  "xcode": { "project": "MyApp.xcodeproj", "scheme": "MyApp" },
  "targets": [
    { "bundleId": "com.example.myapp", "profileName": "My App App Store" },
    { "bundleId": "com.example.myapp.widgets", "profileName": "My App Widgets App Store" }
  ],
  "baseTerritory": "FRA",
  "territories": { "exclude": ["CHN"] },
  "categories": { "primary": "LIFESTYLE" }
}
```

## What we learned shipping

The rules the scripts encode, each from a real submission: [references/lessons.md](plugins/shipfast-apple-connect/skills/shipfast/references/lessons.md). The short version:

- The API can't create the app record, and can't add an app's first subscriptions, group or non-consumable to a review (`FIRST_..._MUST_BE_SUBMITTED_ON_VERSION`).
- Subscriptions need a price in every territory, mainland China included, even where they aren't sold.
- A new availability must list every territory; a free app still needs a price schedule.
- A scheduled release takes whole hours only.
- Archive unsigned and sign at export, or a Swift package target refuses the profile.

## Tests

```bash
node --test plugins/shipfast-apple-connect/skills/shipfast/tests/*.test.mjs
```

The tests run every script against a fake App Store Connect (`tests/mock-asc.mjs`). Nothing leaves the machine. They check, among other things, that no price is written without `--confirm-prices`, that subscriptions get a price in every territory, that `submit.mjs` refuses when a product is missing, in a bad state or not in the draft, and that `--dry` writes nothing.

## Status

v0.1.0, 21 October 2026. The scripts are the ones that shipped Fold Days and Duo Peas, generalized and covered by the tests above; the generalized versions have not yet run against a real account.

## License

[MIT](LICENSE)
