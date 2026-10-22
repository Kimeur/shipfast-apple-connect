// App Store Connect setup from ship/listing.mjs: app info localizations, in-app purchases, the subscription
// group and its subscriptions (localizations, availability, prices, free trial), version metadata and
// App Review information. Idempotent: reads first, creates what is missing, updates what differs, never deletes.
//
// Usage: node store-setup.mjs [--dry] [--only=app,iap,sub,version,review] [--confirm-prices] [--version=1.0.1]
//   --dry             print every write, change nothing
//   --confirm-prices  also set prices and free trials. Without it, price steps print what they would set and
//                     are listed as pending. Pass it only after the owner approved the prices in the listing.
import { asc } from './lib/asc.mjs';
import {
  DRY, EDITABLE, all, allOrEmpty, appId, appVersion, failureLog, flag, get, info, iosVersion, list, maybe, need,
  pool, readListing, rel, rootPath, same, step, territories, versionState, warn, write,
} from './lib/util.mjs';
import { readFileSync, existsSync } from 'node:fs';

const L = await readListing();
const BASE = need('baseTerritory');
const ONLY = list('only') ? new Set(list('only')) : null;
const want = (section) => !ONLY || ONLY.has(section);
const PRICES = flag('confirm-prices') === true;
const { attempt, finish, failures } = failureLog();
const pendingPrices = [];

const APP = await appId();
console.log(`${need('app.name')} · app ${APP}${DRY ? '  (dry run: nothing is written)' : ''}${PRICES ? '' : '  (prices not confirmed: price steps only print)'}`);
const T = await territories();
info(`${T.sold.length} territories sold${T.exclude.size ? ` (all except ${[...T.exclude].join(', ')})` : ''}`);

// ─── App information localizations: name, subtitle, privacy policy URL ───────────────────────────
if (want('app')) {
  const infos = (await asc('GET', `/v1/apps/${APP}/appInfos`)).data;
  const appInfo = infos.find((i) => !['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(i.attributes.state ?? i.attributes.appStoreState)) ?? infos[0];
  const infoState = appInfo.attributes.state ?? appInfo.attributes.appStoreState;
  step('app info localizations (name, subtitle, privacy policy URL)');
  const have = (await all(`/v1/appInfos/${appInfo.id}/appInfoLocalizations?limit=50`)).data;
  for (const [locale, l] of Object.entries(L.locales)) {
    const attrs = { name: l.name, subtitle: l.subtitle, privacyPolicyUrl: l.privacyPolicyUrl };
    const ex = have.find((x) => x.attributes.locale === locale);
    await attempt(`appInfoLocalization ${locale}`, async () => {
      if (ex && same(ex.attributes, attrs)) return info(`${locale}: up to date`);
      if (!EDITABLE.has(infoState)) return warn(`${locale}: differs, but the app info is ${infoState} (not editable now): left as is`);
      if (ex) await write('PATCH', `/v1/appInfoLocalizations/${ex.id}`, { data: { type: 'appInfoLocalizations', id: ex.id, attributes: attrs } });
      else await write('POST', '/v1/appInfoLocalizations', {
        data: { type: 'appInfoLocalizations', attributes: { locale, ...attrs }, relationships: { appInfo: rel('appInfos', appInfo.id) } },
      });
      info(`${locale}: ${ex ? 'updated' : 'created'}`);
    });
  }
}

// ─── Localized metadata of in-app purchases, subscriptions and the group (version resources) ─────
const KINDS = {
  iap: {
    versions: (id) => `/v2/inAppPurchases/${id}/versions`,
    newVersion: (id) => ({ type: 'inAppPurchaseVersions', relationships: { inAppPurchase: rel('inAppPurchases', id) } }),
    versionPath: '/v1/inAppPurchaseVersions', versionType: 'inAppPurchaseVersions',
    locs: (vid) => `/v1/inAppPurchaseVersions/${vid}/localizations`,
    locPath: '/v2/inAppPurchaseLocalizations', locType: 'inAppPurchaseLocalizations',
    legacyLocs: (id) => `/v2/inAppPurchases/${id}/inAppPurchaseLocalizations`,
    legacyPath: '/v1/inAppPurchaseLocalizations', legacyRel: (id) => ({ inAppPurchaseV2: rel('inAppPurchases', id) }),
  },
  sub: {
    versions: (id) => `/v1/subscriptions/${id}/versions`,
    newVersion: (id) => ({ type: 'subscriptionVersions', relationships: { subscription: rel('subscriptions', id) } }),
    versionPath: '/v1/subscriptionVersions', versionType: 'subscriptionVersions',
    locs: (vid) => `/v1/subscriptionVersions/${vid}/localizations`,
    locPath: '/v2/subscriptionLocalizations', locType: 'subscriptionLocalizations',
    legacyLocs: (id) => `/v1/subscriptions/${id}/subscriptionLocalizations`,
    legacyPath: '/v1/subscriptionLocalizations', legacyRel: (id) => ({ subscription: rel('subscriptions', id) }),
  },
  group: {
    versions: (id) => `/v1/subscriptionGroups/${id}/versions`,
    newVersion: (id) => ({ type: 'subscriptionGroupVersions', relationships: { subscriptionGroup: rel('subscriptionGroups', id) } }),
    versionPath: '/v1/subscriptionGroupVersions', versionType: 'subscriptionGroupVersions',
    locs: (vid) => `/v1/subscriptionGroupVersions/${vid}/localizations`,
    locPath: '/v2/subscriptionGroupLocalizations', locType: 'subscriptionGroupLocalizations',
    legacyLocs: (id) => `/v1/subscriptionGroups/${id}/subscriptionGroupLocalizations`,
    legacyPath: '/v1/subscriptionGroupLocalizations', legacyRel: (id) => ({ subscriptionGroup: rel('subscriptionGroups', id) }),
  },
};
const IN_REVIEW = ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW'];

/** Ensure the draft version of an IAP / subscription / group carries these localizations. */
async function ensureLocalizations(kind, parentId, wanted) {
  const k = KINDS[kind];
  let vid = null;
  try {
    const versions = (await all(k.versions(parentId))).data;
    const open = versions.find((v) => v.attributes.state === 'PREPARE_FOR_SUBMISSION');
    const busy = versions.find((v) => IN_REVIEW.includes(v.attributes.state));
    if (open) vid = open.id;
    else if (busy) return info(`${kind} version is ${busy.attributes.state}: localizations locked, skipped`);
    else {
      vid = (await write('POST', k.versionPath, { data: k.newVersion(parentId) })).data.id;
      info(`${kind} draft version created`);
    }
  } catch (e) {
    warn(`${kind} versions API unavailable (${e.status ?? e.message}); using the older localization endpoints`);
  }
  const legacy = !vid;
  const existing = (await all(legacy ? k.legacyLocs(parentId) : k.locs(vid))).data;
  for (const [locale, attrs] of Object.entries(wanted)) {
    const ex = existing.find((x) => x.attributes.locale === locale);
    const path = legacy ? k.legacyPath : k.locPath;
    await attempt(`${kind} ${parentId} localization ${locale}`, async () => {
      if (ex && same(ex.attributes, attrs)) return info(`${locale}: up to date`);
      if (ex) await write('PATCH', `${path}/${ex.id}`, { data: { type: k.locType, id: ex.id, attributes: attrs } });
      else await write('POST', path, {
        data: {
          type: k.locType,
          attributes: { locale, ...attrs },
          relationships: legacy ? k.legacyRel(parentId) : { version: rel(k.versionType, vid) },
        },
      });
      info(`${locale}: ${ex ? 'updated' : 'created'} "${attrs.name}"`);
    });
  }
}

/** Non-consumable price: the base-territory price point, other territories follow Apple's equalization. */
async function ensureIapPrice(id, productId, price) {
  const sched = await maybe(`/v2/inAppPurchases/${id}/iapPriceSchedule`);
  if (sched?.data) {
    const manual = await allOrEmpty(`/v1/inAppPurchasePriceSchedules/${sched.data.id}/manualPrices?include=inAppPurchasePricePoint&limit=50`);
    if (manual.data.length) {
      const pts = manual.included.filter((x) => x.type === 'inAppPurchasePricePoints').map((x) => x.attributes.customerPrice);
      return info(`price already set (${pts.join(', ')}): left as is`);
    }
  }
  const points = (await all(`/v2/inAppPurchases/${id}/pricePoints?filter[territory]=${BASE}&limit=200`)).data;
  const pp = points.find((p) => Number(p.attributes.customerPrice) === Number(price));
  if (!pp && !String(id).includes('DRY')) throw new Error(`no ${BASE} price point at ${price}`);
  if (!PRICES) {
    pendingPrices.push(`${productId}: ${price} (${BASE})`);
    return info(`(prices not confirmed) would set ${price} in ${BASE}, other territories equalized`);
  }
  await write('POST', '/v1/inAppPurchasePriceSchedules', {
    data: {
      type: 'inAppPurchasePriceSchedules',
      relationships: {
        inAppPurchase: rel('inAppPurchases', id),
        baseTerritory: rel('territories', BASE),
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price1}' }] },
      },
    },
    included: [{
      type: 'inAppPurchasePrices', id: '${price1}',
      attributes: { startDate: null },
      relationships: {
        inAppPurchaseV2: rel('inAppPurchases', id),
        inAppPurchasePricePoint: rel('inAppPurchasePricePoints', pp?.id ?? 'DRY'),
      },
    }],
  });
  info(`price set: ${price} (${BASE} base)`);
}

async function ensureIapAvailability(id) {
  const av = await maybe(`/v2/inAppPurchases/${id}/inAppPurchaseAvailability`);
  if (av?.data) {
    const terr = (await all(`/v1/inAppPurchaseAvailabilities/${av.data.id}/availableTerritories?limit=200`)).data;
    if (terr.length) return info(`available in ${terr.length} territories: left as is`);
  }
  await write('POST', '/v1/inAppPurchaseAvailabilities', {
    data: {
      type: 'inAppPurchaseAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        inAppPurchase: rel('inAppPurchases', id),
        availableTerritories: { data: T.sold.map((t) => ({ type: 'territories', id: t })) },
      },
    },
  });
  info(`available in ${T.sold.length} territories`);
}

if (want('iap')) {
  const existing = (await all(`/v1/apps/${APP}/inAppPurchasesV2?limit=200`)).data;
  for (const p of L.products.filter((x) => x.kind === 'iap')) {
    step(`in-app purchase ${p.productId} (${p.inAppPurchaseType}, ${p.price} ${BASE})`);
    let iap = existing.find((x) => x.attributes.productId === p.productId);
    const ok = await attempt(`${p.productId} create/update`, async () => {
      const attrs = { name: p.referenceName, reviewNote: p.reviewNote, familySharable: p.familySharable };
      if (!iap) {
        iap = (await write('POST', '/v2/inAppPurchases', {
          data: {
            type: 'inAppPurchases',
            attributes: { ...attrs, productId: p.productId, inAppPurchaseType: p.inAppPurchaseType },
            relationships: { app: rel('apps', APP) },
          },
        })).data;
        info(`created (${iap.id})`);
      } else if (!same(iap.attributes, attrs)) {
        await write('PATCH', `/v2/inAppPurchases/${iap.id}`, { data: { type: 'inAppPurchases', id: iap.id, attributes: attrs } });
        info(`exists (${iap.id}, ${iap.attributes.state}): updated`);
      } else info(`exists (${iap.id}, ${iap.attributes.state})`);
      return true;
    });
    if (!ok) continue;
    await attempt(`${p.productId} localizations`, () => ensureLocalizations('iap', iap.id, p.localizations));
    await attempt(`${p.productId} price`, () => ensureIapPrice(iap.id, p.productId, p.price));
    await attempt(`${p.productId} availability`, () => ensureIapAvailability(iap.id));
  }
}

async function ensureSubAvailability(id) {
  // Reads that fail (e.g. an endpoint retired later) count as "not set yet".
  const safe = (path) => maybe(path).catch(() => null);
  const plans = (await safe(`/v1/subscriptions/${id}/planAvailabilities`))?.data ?? [];
  const legacy = await safe(`/v1/subscriptions/${id}/subscriptionAvailability`);
  if (plans.length || legacy?.data) {
    const aid = legacy?.data?.id;
    const n = aid ? (await all(`/v1/subscriptionAvailabilities/${aid}/availableTerritories?limit=200`)).data.length : null;
    if (plans.length || n) return info(`availability already set${n ? ` (${n} territories)` : ''}: left as is`);
  }
  const terr = { data: T.sold.map((t) => ({ type: 'territories', id: t })) };
  try {
    // Plan availability. UPFRONT = the normal plan (the full price is paid each period).
    await write('POST', '/v1/subscriptionPlanAvailabilities', {
      data: {
        type: 'subscriptionPlanAvailabilities',
        attributes: { planType: 'UPFRONT', availableInNewTerritories: true },
        relationships: { subscription: rel('subscriptions', id), availableTerritories: terr },
      },
    });
    info(`available in ${T.sold.length} territories (plan availability UPFRONT)`);
  } catch (e) {
    warn(`plan availability refused (${e.status}); using subscriptionAvailabilities`);
    await write('POST', '/v1/subscriptionAvailabilities', {
      data: {
        type: 'subscriptionAvailabilities',
        attributes: { availableInNewTerritories: true },
        relationships: { subscription: rel('subscriptions', id), availableTerritories: terr },
      },
    });
    info(`available in ${T.sold.length} territories`);
  }
}

/** Territory of a subscription price point (from the include, else decoded from its base64 id). */
function pointTerritory(pp) {
  const t = pp.relationships?.territory?.data?.id;
  if (t) return t;
  try { return JSON.parse(Buffer.from(pp.id, 'base64url').toString()).t; } catch { return null; }
}

/**
 * Subscriptions need one price per territory: the base point plus Apple's equalized points.
 * Apple wants a price in EVERY territory, excluded ones (e.g. CHN) included, even where the subscription isn't sold.
 */
async function ensureSubPrices(id, productId, price) {
  const existing = await allOrEmpty(`/v1/subscriptions/${id}/prices?include=territory&limit=200`);
  const priced = new Set(existing.data.map((p) => p.relationships?.territory?.data?.id).filter(Boolean));
  const points = (await all(`/v1/subscriptions/${id}/pricePoints?filter[territory]=${BASE}&limit=200`)).data;
  const base = points.find((p) => Number(p.attributes.customerPrice) === Number(price));
  if (!base) {
    if (String(id).includes('DRY')) return info(`(dry) would price ${price} in ${BASE} and every equalized territory`);
    throw new Error(`no ${BASE} subscription price point at ${price}`);
  }
  const eq = (await all(`/v1/subscriptionPricePoints/${base.id}/equalizations?include=territory&limit=200`)).data;
  const targets = [{ id: base.id, territory: BASE }, ...eq.map((p) => ({ id: p.id, territory: pointTerritory(p) }))]
    .filter((t) => t.territory && !priced.has(t.territory));
  if (!targets.length) return info(`prices already set in ${priced.size} territories: left as is`);
  const missingAll = T.all.filter((t) => !priced.has(t) && !targets.some((x) => x.territory === t));
  if (missingAll.length) warn(`no equalized price point for ${missingAll.join(', ')}: Apple may refuse the submission`);
  if (!PRICES) {
    pendingPrices.push(`${productId}: ${price} (${BASE}) in ${targets.length} territories`);
    return info(`(prices not confirmed) would add ${targets.length} prices (${priced.size} set)`);
  }
  info(`${priced.size} territories priced; adding ${targets.length}`);
  let done = 0;
  await pool(targets, 6, async (t) => {
    await attempt(`subscription price ${productId} ${t.territory}`, () => write('POST', '/v1/subscriptionPrices', {
      data: {
        type: 'subscriptionPrices',
        relationships: {
          subscription: rel('subscriptions', id),
          subscriptionPricePoint: rel('subscriptionPricePoints', t.id),
          territory: rel('territories', t.territory),
        },
      },
    }));
    if (++done % 25 === 0) info(`${done}/${targets.length}`);
  });
  info(`prices set: ${price} in ${BASE} + equalized territories`);
}

/** Free trial for new subscribers, in every territory the subscription is sold in. */
async function ensureFreeTrial(id, productId, duration) {
  const offers = (await allOrEmpty(`/v1/subscriptions/${id}/introductoryOffers?include=territory&limit=200`)).data;
  const trials = offers.filter((o) => o.attributes.offerMode === 'FREE_TRIAL');
  // Apple may leave the territory out of the relationship: then a full set of offers counts as done.
  if (trials.length >= T.sold.length) return info(`free trial already in ${trials.length} territories`);
  const have = new Set(trials.map((o) => o.relationships?.territory?.data?.id).filter(Boolean));
  const todo = T.sold.filter((t) => !have.has(t));
  if (!todo.length) return info(`free trial already in ${have.size} territories`);
  if (!PRICES) {
    pendingPrices.push(`${productId}: free trial ${duration} in ${todo.length} territories`);
    return info(`(prices not confirmed) would add a ${duration} free trial in ${todo.length} territories`);
  }
  info(`free trial in ${have.size} territories; adding ${todo.length}`);
  await pool(todo, 3, (t) => attempt(`free trial ${productId} ${t}`, () => write('POST', '/v1/subscriptionIntroductoryOffers', {
    data: {
      type: 'subscriptionIntroductoryOffers',
      attributes: { duration, offerMode: 'FREE_TRIAL', numberOfPeriods: 1, startDate: null, endDate: null },
      relationships: { subscription: rel('subscriptions', id), territory: rel('territories', t) },
    },
  }).catch((e) => { if (e.status !== 409) throw e; }))); // 409: an offer already covers this territory
  info(`free trial (${duration}) set`);
}

const subscriptions = L.products.filter((x) => x.kind === 'subscription');
if (want('sub') && subscriptions.length) {
  const G = L.subscriptionGroup;
  if (!G) throw new Error('listing has subscriptions but no subscriptionGroup');
  step(`subscription group "${G.referenceName}"`);
  const groups = (await all(`/v1/apps/${APP}/subscriptionGroups?limit=50`)).data;
  let group = groups.find((g) => g.attributes.referenceName === G.referenceName);
  await attempt('subscription group', async () => {
    if (group) return info(`exists (${group.id})`);
    group = (await write('POST', '/v1/subscriptionGroups', {
      data: { type: 'subscriptionGroups', attributes: { referenceName: G.referenceName }, relationships: { app: rel('apps', APP) } },
    })).data;
    info(`created (${group.id})`);
  });
  if (group) {
    await attempt('group localizations', () => ensureLocalizations('group', group.id, G.localizations));
    const subs = (await all(`/v1/subscriptionGroups/${group.id}/subscriptions?limit=50`)).data;
    for (const p of subscriptions) {
      step(`subscription ${p.productId} (${p.subscriptionPeriod}, ${p.price} ${BASE})`);
      let sub = subs.find((s) => s.attributes.productId === p.productId);
      const ok = await attempt(`${p.productId} create/update`, async () => {
        const attrs = { name: p.referenceName, reviewNote: p.reviewNote, familySharable: p.familySharable };
        if (!sub) {
          sub = (await write('POST', '/v1/subscriptions', {
            data: {
              type: 'subscriptions',
              attributes: { ...attrs, productId: p.productId, subscriptionPeriod: p.subscriptionPeriod, groupLevel: p.groupLevel },
              relationships: { group: rel('subscriptionGroups', group.id) },
            },
          })).data;
          info(`created (${sub.id})`);
        } else if (!same(sub.attributes, attrs)) {
          await write('PATCH', `/v1/subscriptions/${sub.id}`, { data: { type: 'subscriptions', id: sub.id, attributes: attrs } });
          info(`exists (${sub.id}, ${sub.attributes.state}): updated`);
        } else info(`exists (${sub.id}, ${sub.attributes.state})`);
        return true;
      });
      if (!ok) continue;
      await attempt(`${p.productId} localizations`, () => ensureLocalizations('sub', sub.id, p.localizations));
      await attempt(`${p.productId} availability`, () => ensureSubAvailability(sub.id));
      await attempt(`${p.productId} prices`, () => ensureSubPrices(sub.id, p.productId, p.price));
      if (p.freeTrial) await attempt(`${p.productId} free trial`, () => ensureFreeTrial(sub.id, p.productId, p.freeTrial));
    }
  }
}

// ─── App Store version: description, keywords, promo text, URLs, copyright ───────────────────────
let version = null;
if (want('version') || want('review')) {
  version = await iosVersion(APP);
  const target = typeof flag('version') === 'string' ? flag('version') : appVersion();
  if (!version) {
    warn('no editable iOS App Store version found');
    failures.push('app store version missing');
  } else {
    step(`App Store version ${version.attributes.versionString} (${versionState(version)}), target ${target}`);
    if (!EDITABLE.has(versionState(version))) {
      warn('this version is not editable any more: version metadata skipped');
      version = null;
    } else if (version.attributes.versionString !== target) {
      await attempt('version string', () => write('PATCH', `/v1/appStoreVersions/${version.id}`, {
        data: { type: 'appStoreVersions', id: version.id, attributes: { versionString: target } },
      }));
    }
  }
}

if (want('version') && version) {
  await attempt('copyright', async () => {
    if (version.attributes.copyright === L.copyright) return info(`copyright: ${L.copyright}`);
    await write('PATCH', `/v1/appStoreVersions/${version.id}`, { data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: L.copyright } } });
    info(`copyright set: ${L.copyright}`);
  });

  step('version localizations (description, keywords, promotional text, support URL)');
  const have = (await all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data;
  for (const [locale, l] of Object.entries(L.locales)) {
    const attrs = {
      description: l.description, keywords: l.keywords, promotionalText: l.promotionalText,
      supportUrl: l.supportUrl, marketingUrl: l.marketingUrl ?? null,
      ...(l.whatsNew ? { whatsNew: l.whatsNew } : {}), // Apple refuses "What's New" on a first version
    };
    const ex = have.find((x) => x.attributes.locale === locale);
    await attempt(`version localization ${locale}`, async () => {
      if (ex && same(ex.attributes, attrs)) return info(`${locale}: up to date`);
      if (ex) await write('PATCH', `/v1/appStoreVersionLocalizations/${ex.id}`, { data: { type: 'appStoreVersionLocalizations', id: ex.id, attributes: attrs } });
      else await write('POST', '/v1/appStoreVersionLocalizations', {
        data: { type: 'appStoreVersionLocalizations', attributes: { locale, ...attrs }, relationships: { appStoreVersion: rel('appStoreVersions', version.id) } },
      });
      info(`${locale}: ${ex ? 'updated' : 'created'}`);
    });
  }
}

// ─── App Review information: contact + notes ─────────────────────────────────────────────────────
if (want('review') && version) {
  step('App Review information');
  await attempt('review details', async () => {
    const c = get('review.contact', {});
    const notesFile = rootPath(get('review.notesFile', 'ship/review-notes.txt'));
    if (!existsSync(notesFile)) throw new Error(`review notes not found: ${notesFile}`);
    const contact = {
      contactFirstName: c.firstName ?? null,
      contactLastName: c.lastName ?? null,
      contactPhone: (typeof flag('contact-phone') === 'string' ? flag('contact-phone') : c.phone) ?? null,
      contactEmail: c.email ?? null,
    };
    const missing = Object.entries(contact).filter(([, v]) => !v || String(v).includes('REPLACE_ME')).map(([k]) => k);
    if (missing.length) throw new Error(`review.contact incomplete (${missing.join(', ')}): Apple requires all four. Put them in ship.local.json.`);
    const attrs = { ...contact, demoAccountRequired: Boolean(get('review.demoAccountRequired', false)), notes: readFileSync(notesFile, 'utf8').trim() };
    const ex = (await maybe(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`))?.data;
    if (ex && same(ex.attributes, attrs)) return info('up to date');
    if (ex) await write('PATCH', `/v1/appStoreReviewDetails/${ex.id}`, { data: { type: 'appStoreReviewDetails', id: ex.id, attributes: attrs } });
    else await write('POST', '/v1/appStoreReviewDetails', {
      data: { type: 'appStoreReviewDetails', attributes: attrs, relationships: { appStoreVersion: rel('appStoreVersions', version.id) } },
    });
    info(`${ex ? 'updated' : 'created'} (contact ${contact.contactFirstName} ${contact.contactLastName})`);
  });
}

step('state of the products');
await attempt('summary', async () => {
  for (const x of (await all(`/v1/apps/${APP}/inAppPurchasesV2?limit=200`)).data) info(`${x.attributes.productId}: ${x.attributes.state}`);
  for (const g of (await all(`/v1/apps/${APP}/subscriptionGroups?limit=50`)).data) {
    for (const s of (await all(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=50`)).data) info(`${s.attributes.productId}: ${s.attributes.state}`);
  }
  info('MISSING_METADATA is expected until the review screenshot is uploaded (screenshots.mjs).');
});

if (pendingPrices.length) {
  console.log(`\nPrices NOT set (owner approval needed, then re-run with --confirm-prices):\n  - ${pendingPrices.join('\n  - ')}`);
}
finish();
