# Lessons from two submissions

Rules learned shipping Duo Peas (submitted 18 Oct 2026) and Fold Days (submitted 21 Oct 2026) through the App Store Connect API. Each one is encoded in a script; the script is named. "Seen" means we hit it on a real account; nothing here is from Apple documentation unless it links there.

## App record and account

- **The API can't create the app record.** `POST /v1/apps` is not available to API keys. The owner creates it on the web (step M3). Seen on both apps. `doctor.mjs` and every script stop with that message.
- **Bundle IDs and App Store profiles can be made through the API** (`/v1/bundleIds`, `/v1/certificates`, `/v1/profiles`). Seen on Fold Days. `signing.mjs`.
- **The Paid Apps agreement must be active**, and Apple posts new versions the owner has to accept. Seen on Duo Peas (a new version was waiting). Agents never accept it. `submit.mjs` reminds.
- **App Privacy "Publish" is the owner's attestation.** The agent can draft the answers; the owner clicks Publish. `submit.mjs` reminds.

## Availability and price

- **A new `appAvailabilities` must list every territory.** Territories you don't sell in are listed with `available: false`, not left out. Seen on Fold Days. `app-setup.mjs`.
- **A free app still needs a price schedule.** A new app has an empty one (no manual price). POST one with the free price point. Seen on Fold Days. `app-setup.mjs`.
- **Mainland China (CHN)** needs extra paperwork for many apps; both apps excluded it (`territories.exclude`).

## Products and prices

- **Ask the owner before anything that sets a price.** `store-setup.mjs` and `app-setup.mjs` set prices only with `--confirm-prices`.
- **Subscriptions need a price in every territory, CHN included, even when the subscription isn't sold there.** Seen on Fold Days. `store-setup.mjs` prices the base territory plus every equalized territory and warns about any territory left without one.
- **Free trials go only where the subscription is sold.** One introductory offer per territory; a 409 means one already covers it.
- **A first subscription stays `MISSING_METADATA` in the API** until it is submitted with a version, even when the web page shows it complete. Seen 18 Oct 2026. `submit.mjs` checks the parts itself (review screenshot, localizations, prices).
- **The first subscription group, first subscriptions and first non-consumable can only be added to a review from the web UI.** The API answers `FIRST_SUBSCRIPTION_MUST_BE_SUBMITTED_ON_VERSION` (and the same for in-app purchases and groups). The owner clicks "Add for Review" on each product page and on the group page. Seen on Fold Days, 21 Oct 2026. `submit.mjs` stops and says so; `--products-added-on-web` then submits the draft.
- **Never submit the app without its products.** Reviewers would see a paywall with no prices and reject it. `submit.mjs` refuses.
- **Product metadata lives on versions** (`inAppPurchaseVersions`, `subscriptionVersions`, `subscriptionGroupVersions`) with older localization endpoints as a fallback. `store-setup.mjs` tries the versions first.

## Listing and version

- **"What's New" is refused on a first version.** Leave `whatsNew: null` for 1.0.
- **A version in a draft review submission can't be edited** (screenshots, header, text). Remove it from the draft on the web first, or work on the next version with `--version`. Seen on Duo Peas (18 Oct 2026). `header.mjs` and `screenshots.mjs` stop on a non-editable version.
- **`earliestReleaseDate` only takes whole hours.** `submit.mjs --release=<date>` refuses minutes before writing anything. Seen on Fold Days (release set to 23 Oct 2026, 15:00 Paris).

## Signing and build

- **Archive unsigned, sign at export.** A Swift package target (RevenueCat's) refuses a forced provisioning profile on the archive. `build-upload.sh` archives with `CODE_SIGNING_ALLOWED=NO` and exports with manual profiles per bundle ID.
- **Use a keychain made for the build** and put it on the search list only while building, then restore the list. `build-upload.sh`.
- **Build number = highest in App Store Connect + 1.** `build-upload.sh`.
- **Uploads need `ITSAppUsesNonExemptEncryption`** in Info.plist (or an answer on the web for each build). `submit.mjs` warns.

## Screenshots

- **iPhone Duo screenshots use display type `APP_IPHONE_DUO`.** Found from the API's enum error on 18 Oct 2026. Fold Days 1.0 uploaded inner-display frames (2853 x 2007, open phone, landscape) with outer-display frames (1398 x 2034) as the fallback; which one Apple kept was not recorded, so treat both sizes as unconfirmed until you see COMPLETE. Duo screenshots become required from April 2027 (Apple news, 5 Oct 2026).
- **Uploads need the MD5 checksum on commit**, or the asset stays waiting forever. Asset library images (header, search) take no checksum and report `state`, not `assetDeliveryState`.
- **Apple rate-limits bursts (429).** The client retries with growing waits; uploads run two sets at a time.

## Simulators

- **Never create a simulator.** Each takes 4-6 GB; seven filled a disk on 17 Oct 2026. The capture scripts find simulators by name and stop if none exists.
- **Poses change only in Device Hub.** Use Duology's `duo-pose` (needs the owner's Accessibility permission) or ask the owner to press Open or Closed.
