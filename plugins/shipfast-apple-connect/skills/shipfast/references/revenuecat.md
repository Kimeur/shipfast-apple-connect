# RevenueCat

Only if the app uses RevenueCat for entitlements. StoreKit 2 alone needs none of this. Every step except the last two is on the RevenueCat dashboard (https://app.revenuecat.com), done by the owner or with the owner watching. Menu names as of October 2026.

## Rules

- **Never paste, type or read out a credential.** The App Store Connect In-App Purchase key (`.p8`) is uploaded once per developer account. For each new app the owner **picks the stored key** from the list. If none is stored, the owner uploads it themselves.
- **Only the public SDK key (`appl_...`) goes in the app.** It is public by design. Secret API keys (`sk_...`) never go in the app, a repo or a chat.
- The products in RevenueCat must use the exact product IDs from `ship/listing.mjs`.

## Steps

1. **Project.** Projects › + New: the app's name.
2. **App Store app.** Project › Apps › + App Store: app name and bundle ID (`app.bundleId`).
3. **In-App Purchase key.** In the app's settings, under In-app purchase key configuration: pick the key already stored for the account (the owner chooses). Fill the issuer ID if asked. RevenueCat may show "Credentials need attention" until the app record exists and has products; check again after `store-setup.mjs` and after release.
4. **Products.** Product catalog › Products › + New, once per product ID in the listing. Or import them from App Store Connect once `store-setup.mjs` has created them.
5. **Entitlement.** Product catalog › Entitlements › + New (for example `myapp_pro`), and attach every product that unlocks it. Use the same identifier in the app's code.
6. **Offering** (optional, if the app reads offerings): Product catalog › Offerings, a default offering with one package per product.
7. **Public SDK key in the build.** Project › API keys: copy the App Store public key (`appl_...`). In the Xcode project, set a build setting such as `REVENUECAT_IOS_KEY = appl_...` for Debug and Release, and read it through Info.plist (`<key>RevenueCatAPIKey</key><string>$(REVENUECAT_IOS_KEY)</string>`). The app should stay off RevenueCat when the setting is empty.
8. **Apple server notifications.** In RevenueCat, the app's settings show an "Apple Server to Server notification URL". The owner pastes it in App Store Connect › the app › App Information › App Store Server Notifications, in both **Production Server URL** and **Sandbox Server URL** (Version 2).

## Privacy

RevenueCat stores a pseudonymous app user ID and purchase history. Say so in the privacy policy and in App Privacy (Purchases, and the identifier you use, for app functionality, not linked to identity unless you log users in, no tracking). Mention it in the review notes.
