# Release checklist

Every step from "the code builds" to "submitted", in order. **Owner** marks a step only the account holder can do: a web step the API can't do, a legal declaration, or a decision. **Agent** marks a step a script does. Copy this list into the app's `TASKS.md` and tick it as you go.

Web steps happen in App Store Connect (https://appstoreconnect.apple.com) unless the row says otherwise. Menu names are as they were in October 2026.

## Before the first app on an account (once)

| # | Who | Step | Why |
|---|---|---|---|
| A1 | Owner | Apple Developer Program membership active. | Nothing works without it. |
| A2 | Owner | Business › Agreements: **Paid Apps agreement** active, with bank and tax forms. Accept new versions when Apple posts them. | Products can't be sold, or go to review usefully, without it. Agents never accept agreements or enter bank details. |
| A3 | Owner | Users and Access › Integrations › App Store Connect API: create a **Team key** with the App Manager role. Download the `.p8` once (Apple won't give it again) into `~/.appstoreconnect/private_keys/`. Note the key ID and issuer ID. | The scripts sign every call with it. Keep it out of every repo. |
| A4 | Owner | Give the agent the key ID, issuer ID and file path through the environment or `ship/ship.local.json`, never in chat logs that get shared. | |

## Each app

| # | Who | Step | Script or place |
|---|---|---|---|
| M1 | Agent | Fill `ship/ship.config.json`, `ship/listing.mjs`, `ship/review-notes.txt`; private bits in `ship/ship.local.json`. Run `doctor.mjs --offline`. | `init.sh`, `doctor.mjs` |
| M2 | Agent | The app's tests pass and it looks right on every device it supports. iPhone Duo apps: Duology's `duo-lint` with zero errors, `duo-pose-matrix` closed and open, nothing in the fold's reserved region. | Tests, `run-sim.sh`, Duology |
| M3 | Owner | **Create the app record**: Apps › + › New App (platform iOS, name, primary language, bundle ID, SKU). The API can't create apps. Then the agent sets `app.appId`. | Web |
| M4 | Agent | Bundle IDs for the app and every extension. | `signing.mjs --only=bundles` |
| M5 | Owner, then Agent | Distribution certificate: reuse one (copy `dist.cer` and `dist.key` into `build/sign/`) or let the agent create one. Ask first: the account holds few. | `signing.mjs --create-cert` |
| M6 | Agent | App Store profiles for every target, keychain for builds. | `signing.mjs` |
| M7 | Owner | Privacy policy page live at the URL in the listing (and the support URL). | Owner's site |
| M8 | Agent | Availability (every territory listed, exclusions closed), price (free), age rating, categories, content rights. Read the age rating answers with the owner. | `app-setup.mjs` |
| M9 | Owner | **Approve the prices** in `ship/listing.mjs` (and the app price if paid). | Decision |
| M10 | Agent | Listing in every language, products, subscription group, localizations, availability, then prices and trial with `--confirm-prices`. Review contact and notes. | `store-setup.mjs` |
| M11 | Owner | **App Privacy**: answer the questions with the agent's draft (data types, purposes, linked or not, tracking), then click **Publish**. Publishing is the owner's attestation: an agent never clicks it. | Web |
| M12 | Owner, with Agent | RevenueCat, if used: project, App Store app, pick the stored In-App Purchase key, products and entitlement; the agent puts the public `appl_` key in build settings. | [revenuecat.md](revenuecat.md) |
| M13 | Owner | App Store Server Notifications: production and sandbox URL from RevenueCat, in App Information › App Store Server Notifications. | Web |
| M14 | Agent | Screenshots (iPhone 6.9"; iPad 13" if the app runs on iPad; iPhone Duo if it targets it), the review screenshot of the paywall on every product, product page header and search asset. | `raw-shots.py`, `store-screens.py`, `store-header.py`, `screenshots.mjs`, `header.mjs` |
| M15 | Owner | Go-ahead to upload. | Decision |
| M16 | Agent | Archive, export, upload; wait for VALID. | `build-upload.sh` |
| M17 | Agent | Attach the build, list what is missing. | `submit.mjs` |
| M18 | Owner | **First products only**: Monetization › each in-app purchase and subscription › **Add for Review**, and the subscription group page › Add for Review. The API refuses first products (`FIRST_..._MUST_BE_SUBMITTED_ON_VERSION`). | Web |
| M19 | Owner | Go-ahead to submit, and the release choice (manual, after approval, or a date on a whole hour). | Decision |
| M20 | Agent | Submit the draft with the version and products. | `submit.mjs --submit --products-added-on-web --release=...` |
| M21 | Agent | Confirm the state is WAITING_FOR_REVIEW; tell the owner what is pending. | `doctor.mjs` |

## After review

| # | Who | Step |
|---|---|---|
| R1 | Owner | Read Apple's email. A rejection comes with a guideline number: reply in Resolution Center or fix and resubmit. |
| R2 | Agent | RevenueCat: re-check "Credentials need attention" on the In-App Purchase key once the app is live. |
| R3 | Agent | For the next version: create it in App Store Connect (web, or `POST /v1/appStoreVersions`), set `app.version` or pass `--version`, and run the pipeline again. "What's New" is allowed from the second version. |
