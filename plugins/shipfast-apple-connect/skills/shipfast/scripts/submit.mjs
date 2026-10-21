// Before App Review: attach the newest processed build, check what the API can check, and list what is missing.
// Sends nothing to App Review unless --submit is passed.
//
// Usage: node submit.mjs [--dry] [--submit] [--release=manual|after-approval|<ISO date, whole hour>]
//                        [--products-added-on-web] [--version=1.0.1]
//   --submit                 create (or reuse) the review submission, add the version and the products, send it
//   --release=...            how the version goes live once approved. A date must be a whole hour in UTC,
//                            e.g. 2026-10-23T13:00:00Z (Apple refuses minutes).
//   --products-added-on-web  the owner clicked "Add for Review" on each first-time product and the group page
//                            in App Store Connect (the API cannot add them, see below). Then the script stops
//                            trying to attach those products itself and submits the draft that holds them.
//
// Rules this encodes (Fold Days, 21 Oct 2026):
// - Never submit the app without its products: reviewers would see a paywall with no prices. If a product the
//   listing declares is missing or can't be attached, nothing is submitted.
// - The first subscription group, first subscriptions and first non-consumable of an app can only be added to a
//   review from the web UI. The API answers FIRST_..._MUST_BE_SUBMITTED_ON_VERSION.
// - App Privacy "Publish" and the Paid Apps agreement are web-only and the owner's own steps.
import { asc, errorCodes } from './lib/asc.mjs';
import {
  DRY, all, appId, failureLog, flag, get, info, iosVersion, maybe, readListing, rel, step, storeProducts,
  versionState, warn, write,
} from './lib/util.mjs';

const L = await readListing();
const APP = await appId();
const version = await iosVersion(APP);
if (!version) throw new Error('no editable App Store version');
const missing = [];
const { finish } = failureLog();
console.log(`${get('app.name')} ${APP} · version ${version.attributes.versionString} (${versionState(version)})${DRY ? ' · dry run' : ''}`);

// ─── Release option (checked first: a bad date should fail before anything is written) ───────────
const release = flag('release');
let releaseAttrs = null;
if (release === true) throw new Error('--release needs a value: manual, after-approval or an ISO date on a whole hour');
if (typeof release === 'string') {
  if (release === 'manual') releaseAttrs = { releaseType: 'MANUAL', earliestReleaseDate: null };
  else if (release === 'after-approval') releaseAttrs = { releaseType: 'AFTER_APPROVAL', earliestReleaseDate: null };
  else {
    const d = new Date(release);
    if (Number.isNaN(d.getTime())) throw new Error(`--release: not a date: ${release}`);
    if (d.getUTCMinutes() || d.getUTCSeconds() || d.getUTCMilliseconds()) {
      throw new Error(`--release: ${release} is not a whole hour. Apple only accepts whole hours (e.g. ${new Date(Math.ceil(d / 3.6e6) * 3.6e6).toISOString().replace('.000', '')}).`);
    }
    if (d <= new Date()) throw new Error('--release: the date is in the past');
    releaseAttrs = { releaseType: 'SCHEDULED', earliestReleaseDate: d.toISOString().replace('.000', '') };
  }
}

// ─── Build ───────────────────────────────────────────────────────────────────────────────────────
step('build');
const builds = (await asc('GET', `/v1/builds?filter[app]=${APP}&filter[preReleaseVersion.version]=${version.attributes.versionString}&sort=-uploadedDate&limit=5`)).data;
const ready = builds.find((b) => b.attributes.processingState === 'VALID');
const attached = (await maybe(`/v1/appStoreVersions/${version.id}/build`))?.data;
if (!builds.length) missing.push('no build uploaded yet (build-upload.sh)');
else if (!ready) missing.push(`build ${builds[0].attributes.version} is ${builds[0].attributes.processingState}: wait and re-run`);
else if (attached?.id === ready.id) info(`build ${ready.attributes.version} attached`);
else {
  await write('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, rel('builds', ready.id));
  info(`build ${ready.attributes.version} attached`);
}
if (ready && ready.attributes.usesNonExemptEncryption == null) {
  warn('export compliance not answered for this build: set ITSAppUsesNonExemptEncryption in Info.plist, or answer it in App Store Connect');
}

// ─── Screenshots ─────────────────────────────────────────────────────────────────────────────────
step('screenshots');
const primaryLocale = get('app.primaryLocale', 'en-US');
const required = get('submit.requiredScreenshots', ['APP_IPHONE_67']);
const recommended = get('submit.recommendedScreenshots', []);
const locs = (await all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data;
const primary = locs.find((l) => l.attributes.locale === primaryLocale);
if (!primary) missing.push(`no ${primaryLocale} localization (store-setup.mjs)`);
else {
  const sets = (await all(`/v1/appStoreVersionLocalizations/${primary.id}/appScreenshotSets`)).data;
  for (const type of [...required, ...recommended]) {
    const set = sets.find((s) => s.attributes.screenshotDisplayType === type);
    const n = set ? (await all(`/v1/appScreenshotSets/${set.id}/appScreenshots`)).data.length : 0;
    if (n) info(`${type}: ${n}`);
    else if (required.includes(type)) missing.push(`${primaryLocale} ${type} screenshots (screenshots.mjs)`);
    else warn(`${type}: none (recommended in submit.recommendedScreenshots)`);
  }
}

// ─── Review details ──────────────────────────────────────────────────────────────────────────────
step('review details');
const rd = (await maybe(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`))?.data;
if (!rd?.attributes.contactPhone || !rd?.attributes.contactEmail) missing.push('App Review contact (store-setup.mjs --only=review)');
else info(`contact ${rd.attributes.contactFirstName} ${rd.attributes.contactLastName}, phone and email set`);
if (!rd?.attributes.notes) missing.push('App Review notes (review.notesFile, then store-setup.mjs --only=review)');

// ─── Products: every product in the listing must exist, be complete and ride along ───────────────
step('products');
const items = await storeProducts(APP);
const declared = new Set((L.products ?? []).map((p) => p.productId));
const found = new Set(items.map((x) => x.resource.attributes.productId));
for (const id of declared) if (!found.has(id)) missing.push(`${id} is in the listing but not in App Store Connect (store-setup.mjs)`);
// States in which a product can go to review with the app, or is already there or approved.
const OK_STATES = new Set(['READY_TO_SUBMIT', 'MISSING_METADATA', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'APPROVED', 'READY_FOR_SALE']);
for (const { kind, resource: x } of items) {
  info(`${x.attributes.productId}: ${x.attributes.state}`);
  if (!OK_STATES.has(x.attributes.state)) {
    if (declared.has(x.attributes.productId)) missing.push(`${x.attributes.productId} is ${x.attributes.state}: fix it in App Store Connect before submitting`);
    continue;
  }
  if (x.attributes.state !== 'MISSING_METADATA') continue;
  // A first subscription stays MISSING_METADATA in the API until it is submitted with an app version, even when
  // the web page shows it complete (18 Oct 2026). Check the parts ourselves.
  const shot = await maybe(`/${kind === 'iap' ? 'v2/inAppPurchases' : 'v1/subscriptions'}/${x.id}/appStoreReviewScreenshot`);
  const prices = kind === 'subscription' ? (await all(`/v1/subscriptions/${x.id}/prices?limit=200`).catch(() => ({ data: [] }))).data : [];
  const sublocs = kind === 'subscription' ? (await all(`/v1/subscriptions/${x.id}/subscriptionLocalizations`).catch(() => ({ data: [] }))).data : [];
  if (kind === 'subscription' && shot?.data && sublocs.length && prices.length) {
    info(`   review screenshot, ${sublocs.length} localizations and ${prices.length} prices present: OK for a first subscription`);
  } else missing.push(`${x.attributes.productId} is MISSING_METADATA (prices, localizations or review screenshot)`);
}

console.log('\nAlways manual, in App Store Connect (references/manual-steps.md):');
console.log('  - App Privacy › Publish: the owner\'s attestation, never clicked by an agent');
console.log('  - Business › Paid Apps agreement: Active (needed for any paid product)');
if (items.length) console.log('  - First products of the app: "Add for Review" on each product page and on the subscription group page');

if (missing.length) {
  console.log(`\nStill missing:\n  - ${missing.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nEverything the API can check is in place.');

if (flag('submit') !== true) {
  console.log(`Submit with: node submit.mjs --submit${releaseAttrs ? ` --release=${release}` : ''}`);
  process.exit(0);
}

// ─── Submit ──────────────────────────────────────────────────────────────────────────────────────
if (releaseAttrs) {
  step(`release: ${releaseAttrs.releaseType}${releaseAttrs.earliestReleaseDate ? ` from ${releaseAttrs.earliestReleaseDate}` : ''}`);
  await write('PATCH', `/v1/appStoreVersions/${version.id}`, { data: { type: 'appStoreVersions', id: version.id, attributes: releaseAttrs } });
}

step('review submission');
// Reuse a draft left by an earlier attempt or made on the web (Apple allows one open draft per platform).
const drafts = (await asc('GET', `/v1/reviewSubmissions?filter[app]=${APP}&filter[state]=READY_FOR_REVIEW&filter[platform]=IOS`)).data;
const sub = drafts[0] ?? (await write('POST', '/v1/reviewSubmissions', {
  data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: rel('apps', APP) } },
})).data;
info(drafts[0] ? `reusing draft submission ${sub.id}` : `draft submission ${sub.id} created`);

const inDraft = drafts[0] ? (await all(`/v1/reviewSubmissions/${sub.id}/items?limit=50`).catch(() => ({ data: [] }))).data : [];
const hasVersion = inDraft.some((i) => i.relationships?.appStoreVersion?.data?.id === version.id);
if (!hasVersion) {
  await write('POST', '/v1/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: rel('reviewSubmissions', sub.id), appStoreVersion: rel('appStoreVersions', version.id) } },
  });
  info(`version ${version.attributes.versionString} added`);
} else info(`version ${version.attributes.versionString} already in the draft`);

const webOnly = [];
const failed = [];
const unconfirmed = [];
// Every resource id the draft's items point at, whatever the relationship is called.
const draftRefs = new Set(inDraft.flatMap((i) => Object.values(i.relationships ?? {}).map((r) => r?.data?.id).filter(Boolean)));
const onWeb = flag('products-added-on-web') === true;
for (const { kind, resource: x } of items) {
  if (!['READY_TO_SUBMIT', 'MISSING_METADATA'].includes(x.attributes.state)) continue;
  if (onWeb) {
    // The owner says it is in the draft: check that the draft really refers to it.
    if (draftRefs.has(x.id)) info(`${x.attributes.productId}: in the draft (added on the web)`);
    else unconfirmed.push(x.attributes.productId);
    continue;
  }
  const t = kind === 'iap' ? 'inAppPurchaseSubmissions' : 'subscriptionSubmissions';
  const r = kind === 'iap' ? { inAppPurchaseV2: rel('inAppPurchases', x.id) } : { subscription: rel('subscriptions', x.id) };
  try {
    await write('POST', `/v1/${t}`, { data: { type: t, relationships: r } });
    info(`${x.attributes.productId} attached`);
  } catch (e) {
    if (errorCodes(e).some((c) => /FIRST_.*MUST_BE_SUBMITTED_ON_VERSION/.test(c)) || /FIRST_.*MUST_BE_SUBMITTED_ON_VERSION/.test(e.message)) {
      webOnly.push(x.attributes.productId);
    } else {
      warn(`${x.attributes.productId}: ${e.message}`);
      failed.push(x.attributes.productId);
    }
  }
}

if (webOnly.length) {
  console.log(`\nNot submitted. These are the app's first products, which only the web UI can add to a review:\n  - ${webOnly.join('\n  - ')}`);
  console.log(`In App Store Connect › your app › Monetization: open each product and the subscription group, click "Add for Review",`);
  console.log(`then re-run: node submit.mjs --submit --products-added-on-web. The draft ${sub.id} stays open.`);
  process.exit(1);
}
if (unconfirmed.length) {
  console.log(`\nNot submitted: the draft ${sub.id} doesn't show these products, so the script can't confirm they ride along:\n  - ${unconfirmed.join('\n  - ')}`);
  console.log('Open the draft in App Store Connect (the app page, "Draft Submissions"). If the products are listed there with the version, the owner submits from that page. If not, "Add for Review" on each product first.');
  process.exit(1);
}
// Never send the app without its products: reviewers would see a paywall with no prices.
if (failed.length) {
  console.log(`\nNot submitted: ${failed.join(', ')} could not be attached. The draft ${sub.id} is left open.`);
  process.exit(1);
}
await write('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
info(`submitted (${sub.id})`);
finish('Submitted for App Review. Watch for Apple\'s email; nothing else to run until then.');
