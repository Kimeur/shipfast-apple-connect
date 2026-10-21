# Sources

What the scripts rely on, and how sure we are. "Used" means a script called it on a real account and it worked, on the date given. Apple documentation pages need JavaScript; agents can read the same content as JSON by swapping `https://developer.apple.com/documentation/<path>` for `https://developer.apple.com/tutorials/data/documentation/<path>.json`.

## Apple

| ID | Page | URL | Used for |
|---|---|---|---|
| S1 | App Store Connect API | https://developer.apple.com/documentation/appstoreconnectapi | Every endpoint in `scripts/`. |
| S2 | Generating tokens for API requests | https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests | The ES256 JWT in `lib/asc.mjs`. |
| S3 | Uploading assets to App Store Connect | https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect | Reserve, upload, commit with checksum (`uploadAsset`). |
| S4 | Screenshot specifications | https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications | Sizes per display type. |
| S5 | Prepare and submit your apps for iPhone Duo (news, 5 Oct 2026) | https://developer.apple.com/news/?id=kkphp5qo | Duo screenshots required from April 2027, rebuild with Xcode 27.1. |
| S6 | App Review Guidelines, 3.1.2 Subscriptions | https://developer.apple.com/app-store/review/guidelines/#subscriptions | What the listing and paywall must say about renewals. |
| S7 | Offer auto-renewable subscriptions | https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions | First subscriptions are submitted with an app version. |
| S8 | Enter server URLs for App Store Server Notifications | https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications | RevenueCat step 8. |
| S9 | Xcode 27.1 Release Notes | https://developer.apple.com/documentation/xcode-release-notes/xcode-27_1-release-notes | The toolchain the scripts build with. |

Every URL on this page was fetched on 21 Oct 2026 and returned the page named in the table (Apple help pages answer 200 even for missing pages, so their titles were checked too). That checks the links, not every claim: rows under "What we found ourselves" come from our own runs.

## RevenueCat

| ID | Page | URL | Used for |
|---|---|---|---|
| R1 | App Store Connect In-App Purchase key | https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration | Step 3 of `revenuecat.md`. |
| R2 | Apple App Store Server Notifications | https://www.revenuecat.com/docs/platform-resources/server-notifications/apple-server-notifications | Step 8. |

## What we found ourselves

| Fact | How | Date |
|---|---|---|
| `APP_IPHONE_DUO` display type | The API's enum error on `POST /v1/appScreenshotSets`, then the Fold Days upload | 18 and 21 Oct 2026 |
| Duo frames uploaded | Fold Days 1.0: the inner-display set (2853 x 2007) with an outer-display fallback (1398 x 2034) ready. Which size Apple kept was not recorded. | 21 Oct 2026 |
| `FIRST_..._MUST_BE_SUBMITTED_ON_VERSION` for first products | Fold Days `POST /v1/subscriptionSubmissions` | 21 Oct 2026 |
| Subscriptions need a price in CHN though not sold there | Fold Days, while setting prices | 21 Oct 2026 |
| `earliestReleaseDate` whole hours only | Fold Days release date | 21 Oct 2026 |
| A first subscription stays `MISSING_METADATA` until submitted | Duo Peas | 18 Oct 2026 |
| `appAvailabilities` must list every territory | Fold Days `POST /v2/appAvailabilities` | 21 Oct 2026 |
| A new app's price schedule is empty | Fold Days `GET /v1/apps/{id}/appPriceSchedule` | 21 Oct 2026 |
