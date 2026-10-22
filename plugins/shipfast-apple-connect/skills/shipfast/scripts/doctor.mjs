// Read-only check of the release setup: config, listing limits, files, API key, and what App Store Connect holds.
// Changes nothing, anywhere. Run it first and after every step.
//
// Usage: node doctor.mjs [--offline]
//   --offline  skip every App Store Connect call (config, listing and files only)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_PATH } from './lib/config.mjs';
import { asc, credentials } from './lib/asc.mjs';
import { EDITABLE, all, appVersion, flag, get, maybe, readListing, rootPath, versionState } from './lib/util.mjs';

const problems = [];
const notes = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.log(`  FIX   ${m}`); problems.push(m); };
const note = (m) => { console.log(`  note  ${m}`); notes.push(m); };
const OFFLINE = flag('offline') === true;

console.log(`shipfast doctor · ${CONFIG_PATH}${OFFLINE ? ' · offline' : ''}\n`);

// ─── Config ──────────────────────────────────────────────────────────────────────────────────────
console.log('Config');
const placeholder = (v) => v === undefined || v === null || v === '' || String(v).includes('REPLACE_ME');
for (const key of ['app.name', 'app.bundleId', 'team.teamId', 'xcode.project', 'xcode.scheme', 'baseTerritory', 'categories.primary']) {
  placeholder(get(key)) ? bad(`${key} is not set`) : ok(`${key} = ${get(key)}`);
}
placeholder(get('app.appId')) ? note('app.appId not set yet: create the app record on the web (manual step M3)') : ok(`app.appId = ${get('app.appId')}`);
const proj = get('xcode.project') && rootPath(get('xcode.project'));
if (proj && !placeholder(get('xcode.project'))) {
  if (!existsSync(proj)) bad(`Xcode project not found: ${proj}`);
  else { try { ok(`MARKETING_VERSION ${appVersion()}`); } catch (e) { bad(e.message); } }
}
for (const t of get('targets', [])) placeholder(t.bundleId) || placeholder(t.profileName) ? bad(`target ${JSON.stringify(t)} incomplete`) : ok(`target ${t.bundleId} → "${t.profileName}"`);
const rawConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
if (rawConfig.ascKey) bad('ascKey is in ship.config.json: move it to ship.local.json (gitignored) or the environment');
if (rawConfig.review?.contact?.email && !String(rawConfig.review.contact.email).includes('REPLACE_ME')) note('review.contact is in ship.config.json: keep it in ship.local.json if the repo is public');
const gitignore = rootPath('.gitignore');
if (existsSync(gitignore)) {
  const gi = readFileSync(gitignore, 'utf8');
  for (const p of ['build/', 'ship.local.json']) gi.includes(p) ? ok(`.gitignore has ${p}`) : bad(`.gitignore should list ${p} (signing secrets, private contact)`);
} else bad('no .gitignore in the app root: add build/ and ship/ship.local.json');

// ─── Listing ─────────────────────────────────────────────────────────────────────────────────────
console.log('\nListing');
let L = null;
try { L = await readListing(); ok(`${Object.keys(L.locales).length} locale(s): ${Object.keys(L.locales).join(', ')}`); } catch (e) { bad(e.message); }
const LIMITS = { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000, whatsNew: 4000 };
if (L) {
  for (const [locale, l] of Object.entries(L.locales)) {
    for (const [k, max] of Object.entries(LIMITS)) {
      const v = l[k];
      if (v && [...v].length > max) bad(`${locale} ${k}: ${[...v].length} characters, limit ${max}`);
    }
    for (const k of ['name', 'description', 'keywords', 'privacyPolicyUrl', 'supportUrl']) if (!l[k]) bad(`${locale} ${k} is empty`);
    if (/REPLACE_ME|example\.com/.test(JSON.stringify(l))) bad(`${locale} still has template text (REPLACE_ME or example.com)`);
  }
  const ids = new Set();
  for (const p of L.products ?? []) {
    if (ids.has(p.productId)) bad(`duplicate product ${p.productId}`);
    ids.add(p.productId);
    if (!String(p.productId).startsWith(String(get('app.bundleId')))) note(`${p.productId} does not start with the bundle ID (allowed, but unusual)`);
    for (const [locale, loc] of Object.entries(p.localizations ?? {})) {
      if ([...(loc.name ?? '')].length > 30) bad(`${p.productId} ${locale} name over 30 characters`);
      if ([...(loc.description ?? '')].length > 55) bad(`${p.productId} ${locale} description over 55 characters`);
    }
    for (const locale of Object.keys(L.locales)) if (!p.localizations?.[locale]) note(`${p.productId} has no ${locale} localization`);
    if (!p.price) bad(`${p.productId} has no price`);
  }
  if ((L.products ?? []).some((p) => p.kind === 'subscription')) {
    if (!L.subscriptionGroup) bad('subscriptions without a subscriptionGroup');
    for (const locale of Object.keys(L.locales)) {
      const d = L.locales[locale].description ?? '';
      if (!/(renew|renouvel|verläng|renueva|rinnov)/i.test(d)) note(`${locale} description does not say subscriptions renew automatically (Apple asks for it, guideline 3.1.2)`);
    }
  }
  if (L.products?.length) note(`prices in the listing: ${L.products.map((p) => `${p.productId.split('.').pop()} ${p.price}`).join(', ')} (${get('baseTerritory')}). The owner approves these before --confirm-prices.`);
}

// ─── Files ───────────────────────────────────────────────────────────────────────────────────────
console.log('\nFiles');
const notesFile = rootPath(get('review.notesFile', 'ship/review-notes.txt'));
existsSync(notesFile) ? ok(`review notes ${notesFile}`) : bad(`review notes missing: ${notesFile}`);
const c = get('review.contact', {});
['firstName', 'lastName', 'email', 'phone'].every((k) => c[k] && !String(c[k]).includes('REPLACE_ME')) ? ok('App Review contact set') : bad('review.contact incomplete (put it in ship.local.json)');
const shots = rootPath(get('screenshots.dir', 'Launch/store-screens'));
existsSync(shots) ? ok(`screenshots folder ${shots}`) : note(`no screenshots yet in ${shots} (raw-shots.py, then store-screens.py)`);
const sign = rootPath(get('signing.dir', 'build/sign'));
existsSync(join(sign, 'signing.keychain-db')) ? ok('signing keychain in build/sign') : note('no signing keychain yet (signing.mjs)');

// ─── App Store Connect ───────────────────────────────────────────────────────────────────────────
if (!OFFLINE) {
  console.log('\nApp Store Connect');
  try {
    const cr = credentials();
    const short = `${cr.keyId.slice(0, 3)}…`;
    ok(`API key ${short} (${cr.keyPath.replace(process.env.HOME, '~').replaceAll(cr.keyId, short)})`);
    const apps = (await asc('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(get('app.bundleId'))}`)).data
      .filter((a) => a.attributes.bundleId === get('app.bundleId'));
    if (!apps.length) bad(`no app record for ${get('app.bundleId')}: create it on the web (manual step M3)`);
    else {
      const app = apps[0];
      ok(`app record ${app.id} "${app.attributes.name}"`);
      if (get('app.appId') && String(get('app.appId')) !== app.id) bad(`app.appId is ${get('app.appId')} but the bundle ID belongs to ${app.id}`);
      const versions = (await asc('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`)).data;
      for (const v of versions) ok(`version ${v.attributes.versionString}: ${versionState(v)}${EDITABLE.has(versionState(v)) ? ' (editable)' : ''}`);
      let built = null;
      try { built = appVersion(); } catch { /* reported under Config */ }
      if (built && !versions.some((v) => v.attributes.versionString === built)) {
        note(`no App Store version ${built} (MARKETING_VERSION) yet: the release scripts need it, or --version=<an existing one>`);
      }
      const av = await maybe(`/v1/apps/${app.id}/appAvailabilityV2`);
      av?.data ? ok('availability set') : note('no availability yet (app-setup.mjs)');
      const sched = await maybe(`/v1/apps/${app.id}/appPriceSchedule`);
      const priced = sched?.data && (await asc('GET', `/v1/appPriceSchedules/${sched.data.id}/manualPrices?limit=1`)).data.length;
      priced ? ok('app price set') : note('no app price yet: a new app has an empty schedule (app-setup.mjs)');
    }
    for (const t of get('targets', [{ bundleId: get('app.bundleId') }])) {
      const b = (await all(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(t.bundleId)}&limit=20`)).data.find((x) => x.attributes.identifier === t.bundleId);
      b ? ok(`bundle ID ${t.bundleId}`) : note(`bundle ID ${t.bundleId} not registered yet (signing.mjs --only=bundles)`);
    }
  } catch (e) {
    bad(`App Store Connect: ${e.message}`);
  }
}

console.log(`\n${problems.length ? `${problems.length} thing(s) to fix` : 'Nothing to fix'}${notes.length ? `, ${notes.length} note(s)` : ''}.`);
console.log('Web-only steps the API cannot check: Paid Apps agreement, App Privacy › Publish, first products "Add for Review".');
process.exit(problems.length ? 1 : 0);
