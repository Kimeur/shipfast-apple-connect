// App Store listing, every localization. Read by store-setup.mjs, screenshots.mjs, header.mjs and submit.mjs.
// Limits: name and subtitle 30 characters, keywords 100, promotional text 170, description 4000.
// In-app purchase names 30, descriptions 55. doctor.mjs checks them.
// Prices are in the config's baseTerritory currency. The owner decides them: store-setup.mjs sets prices only
// with --confirm-prices.

const TERMS = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_EN = 'https://example.com/en/my-app/privacy';
const PRIVACY_FR = 'https://example.com/fr/my-app/privacy';
const urls = (fr) => ({
  privacyPolicyUrl: fr ? PRIVACY_FR : PRIVACY_EN,
  supportUrl: `${fr ? PRIVACY_FR : PRIVACY_EN}#contact`,
  marketingUrl: null,
});

const enUS = {
  name: 'My App',
  subtitle: 'REPLACE_ME: the promise, 30 max',
  keywords: 'REPLACE_ME,comma,separated,no,spaces,after,commas',
  promotionalText: 'REPLACE_ME: can change any time without a new version.',
  description: `REPLACE_ME: the first two lines show before "more", so put the promise there.

BUILT FOR IPHONE DUO
Closed, My App fits the outer display. Open, it becomes two panes with the fold between them.

FREE AND PRO
REPLACE_ME: what is free, what Pro adds, the periods and the trial.

Subscriptions renew automatically unless cancelled at least 24 hours before the end of the period. Manage or cancel them in Settings › your name › Subscriptions.
Terms of Use: ${TERMS}
Privacy Policy: ${PRIVACY_EN}`,
  whatsNew: null, // Apple refuses "What's New" on a first version
  ...urls(false),
};

const frFR = {
  ...enUS,
  subtitle: 'REPLACE_ME : la promesse',
  keywords: 'REPLACE_ME,mots,clés',
  promotionalText: 'REPLACE_ME',
  description: `REPLACE_ME

Les abonnements se renouvellent automatiquement sauf résiliation au moins 24 heures avant la fin de la période. Gérez-les ou résiliez-les dans Réglages › votre nom › Abonnements.
Conditions d’utilisation : ${TERMS}
Politique de confidentialité : ${PRIVACY_FR}`,
  ...urls(true),
};

const locales = { 'en-US': enUS, 'en-GB': { ...enUS }, 'fr-FR': frFR, 'fr-CA': { ...frFR } };

const proLoc = (period) => ({
  'en-US': { name: `My App Pro, ${period.en}`, description: 'REPLACE_ME: 55 characters max' },
  'en-GB': { name: `My App Pro, ${period.en}`, description: 'REPLACE_ME: 55 characters max' },
  'fr-FR': { name: `My App Pro, ${period.fr}`, description: 'REPLACE_ME : 55 caractères max' },
  'fr-CA': { name: `My App Pro, ${period.fr}`, description: 'REPLACE_ME : 55 caractères max' },
});

const WHERE = 'Where: Settings tab › "Get My App Pro". Restore purchases is in the Settings tab.';

export default {
  copyright: '2026 Example Studio',
  locales,
  subscriptionGroup: {
    referenceName: 'My App Pro',
    localizations: {
      'en-US': { name: 'My App Pro' }, 'en-GB': { name: 'My App Pro' },
      'fr-FR': { name: 'My App Pro' }, 'fr-CA': { name: 'My App Pro' },
    },
  },
  // Leave products empty for a free app with no purchases.
  products: [
    {
      productId: 'com.example.myapp.pro.yearly',
      kind: 'subscription',
      referenceName: 'My App Pro yearly',
      subscriptionPeriod: 'ONE_YEAR',
      groupLevel: 1,
      price: '19.99',
      freeTrial: 'ONE_WEEK',
      familySharable: true,
      reviewNote: `Auto-renewable yearly subscription with a 1-week free trial for new subscribers. ${WHERE}`,
      localizations: proLoc({ en: 'yearly', fr: 'annuel' }),
    },
    {
      productId: 'com.example.myapp.pro.monthly',
      kind: 'subscription',
      referenceName: 'My App Pro monthly',
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 2,
      price: '2.99',
      freeTrial: null,
      familySharable: true,
      reviewNote: `Auto-renewable monthly subscription, same content as the yearly one. ${WHERE}`,
      localizations: proLoc({ en: 'monthly', fr: 'mensuel' }),
    },
    {
      productId: 'com.example.myapp.pro.lifetime',
      kind: 'iap',
      inAppPurchaseType: 'NON_CONSUMABLE',
      referenceName: 'My App Pro lifetime',
      price: '39.99',
      familySharable: true,
      reviewNote: `One-time purchase with the same content as the subscriptions, for good. ${WHERE}`,
      localizations: proLoc({ en: 'lifetime', fr: 'à vie' }),
    },
  ],
};
