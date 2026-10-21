# ship.config.json

Lives at `<app>/ship/ship.config.json`. `ship/ship.local.json` (gitignored) is merged over it: put the API key and the App Review contact there. Paths are relative to the app folder (`root`, default the folder above `ship/`). Start from `templates/ship.config.example.json`; `doctor.mjs --offline` checks it.

| Key | Required | Meaning |
|---|---|---|
| `app.name` | yes | App name as in App Store Connect. |
| `app.bundleId` | yes | The app's bundle ID. |
| `app.appId` | after step M3 | App Store Connect app id (digits). Scripts check it against the bundle ID. |
| `app.primaryLocale` | no | Default `en-US`. Used by `submit.mjs` to check screenshots. |
| `app.version` | no | Overrides `MARKETING_VERSION` from the Xcode project. |
| `team.teamId` | yes | 10-character team ID, for the export options. |
| `team.name` | no | Organization in the certificate request. |
| `xcode.project`, `xcode.scheme` | yes | The `.xcodeproj` and the scheme to archive. |
| `xcode.developerDir` | no | Default `/Applications/Xcode-27.1.app/Contents/Developer`. |
| `targets[]` | yes with extensions | `{ bundleId, name, profileName, capabilities? }` for the app and each extension (widgets, intents). Default: the app alone. |
| `listing` | no | Default `ship/listing.mjs`. |
| `baseTerritory` | yes | Territory whose currency the prices in the listing use, e.g. `FRA` (euros). Other territories follow Apple's equalization. |
| `appPrice` | no | Default `"0"` (free). A paid price needs `--confirm-prices`. |
| `territories.exclude` | no | Territories not sold in, e.g. `["CHN"]`. Still listed (closed) in the availability, and still priced for subscriptions. |
| `categories.primary`, `.secondary` | primary yes | App Store category ids, e.g. `LIFESTYLE`, `PRODUCTIVITY`, `GAMES_PUZZLE`. |
| `contentRights` | no | Default `DOES_NOT_USE_THIRD_PARTY_CONTENT`. |
| `ageRating` | no | Answers that differ from "none" (a declaration: check with the owner). |
| `review.notesFile` | yes | Plain text for App Review: what the app does, where the purchases are, what is free. |
| `review.contact` | yes | `firstName`, `lastName`, `email`, `phone` (in `ship.local.json`). |
| `review.demoAccountRequired` | no | Default `false`. |
| `screenshots.dir` | no | Default `Launch/store-screens`. |
| `screenshots.localeSources` | no | Locales that reuse another locale's frames, e.g. `{"en-GB": "en-US"}`. |
| `screenshots.types` | no | Override or add display types: `{ "<key>": { type, folder, sizes, fallback? } }`. |
| `screenshots.reviewShot` | no | Default `review/paywall.png` under `screenshots.dir`. |
| `submit.requiredScreenshots` | no | Display types that must have frames in the primary locale. Default `["APP_IPHONE_67"]`. |
| `submit.recommendedScreenshots` | no | Warned about when missing. Default `[]`; iPhone Duo apps add `"APP_IPHONE_DUO"`. |
| `capture.*` | for screenshots | `appPath`, `launchArgs`, `runSimulator`, `languages`, `wait`, `devices`, `shots`. See `raw-shots.py`. Remove the `duo-*` devices if the app doesn't target iPhone Duo. |
| `screens.*` | for screenshots | `shots`, `locales`, `captions`, `colors`, `font`, `reviewShot`. See `store-screens.py`. |
| `header.*` | for the header | `icon`, `texts`, `shots`. See `store-header.py`. |
| `signing.dir` | no | Default `build/sign`. |

## listing.mjs

A JavaScript module, so long descriptions can use template strings. Default export:

```js
export default {
  copyright: '2026 Example Studio',
  locales: { 'en-US': { name, subtitle, keywords, promotionalText, description, whatsNew, privacyPolicyUrl, supportUrl, marketingUrl } },
  subscriptionGroup: { referenceName, localizations: { 'en-US': { name } } },
  products: [
    { productId, kind: 'subscription', referenceName, subscriptionPeriod: 'ONE_YEAR', groupLevel: 1, price: '19.99',
      freeTrial: 'ONE_WEEK', familySharable: true, reviewNote, localizations: { 'en-US': { name, description } } },
    { productId, kind: 'iap', inAppPurchaseType: 'NON_CONSUMABLE', referenceName, price: '39.99', familySharable: true,
      reviewNote, localizations },
  ],
};
```

`subscriptionPeriod`: `ONE_WEEK`, `ONE_MONTH`, `TWO_MONTHS`, `THREE_MONTHS`, `SIX_MONTHS`, `ONE_YEAR`. `freeTrial` takes the same values (`ONE_WEEK`, `ONE_MONTH`...) plus `THREE_DAYS`, `TWO_WEEKS`, or `null`. `groupLevel` 1 is the highest tier.
