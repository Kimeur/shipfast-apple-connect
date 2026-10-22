// Upload the App Store screenshots and the in-app purchase review screenshot (re-runnable).
//
// Layout (config screenshots.dir, default Launch/store-screens):
//   <dir>/<folder>/<locale>/*.png   one folder per display type, see TYPES (config screenshots.types overrides)
//   <dir>/review/paywall.png        App Review screenshot for every product (config screenshots.reviewShot)
// Locales with no folder of their own reuse another (config screenshots.localeSources, e.g. {"en-GB": "en-US"}).
// Files are uploaded in file-name order (01-…), ten at most per set. A file already in the set with the
// same name and md5 is skipped.
//
// Usage: node screenshots.mjs [--dry] [--locales=en-US,fr-FR] [--types=iphone,ipad,duo] [--replace] [--no-review]
//                             [--review-shot=<png>] [--version=1.0.1]
//   --replace  also delete screenshots in a set that are not in the folder (only in the --types given)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc } from './lib/asc.mjs';
import {
  DRY, EDITABLE, all, appId, failureLog, flag, get, info, list, maybe, md5, pngSize, pngs, pool,
  readListing, requireVersion, rootPath, step, uploadAsset, versionState, waitAsset, warn, write,
} from './lib/util.mjs';

const DIR = rootPath(get('screenshots.dir', 'Launch/store-screens'));
// Sizes are width x height in pixels. A type with no folder of frames is skipped, so iPad and iPhone Duo are optional.
// APP_IPHONE_DUO (the foldable iPhone) is the display type the API named in its enum error (18 Oct 2026); which Duo
// sizes Apple accepts is not confirmed, so the outer-display folder is the fallback.
const DEFAULT_TYPES = {
  iphone: { type: 'APP_IPHONE_67', folder: 'iphone69', sizes: ['1320x2868', '1290x2796'] },
  ipad: { type: 'APP_IPAD_PRO_3GEN_129', folder: 'ipad13', sizes: ['2064x2752', '2048x2732'], fallback: 'ipad13-2048' },
  duo: { type: 'APP_IPHONE_DUO', folder: 'iphoneduo', sizes: ['2853x2007', '2007x2853', '1398x2034'], fallback: 'iphoneduo-outer' },
};
const TYPES = { ...DEFAULT_TYPES, ...get('screenshots.types', {}) };
const L = await readListing();
const SOURCES = Object.fromEntries(Object.keys(L.locales).map((l) => [l, get(`screenshots.localeSources.${l}`, l)]));

const { attempt, finish, failures } = failureLog();
const APP = await appId();
const version = await requireVersion(APP);
console.log(`${get('app.name')} ${APP} · version ${version.attributes.versionString} (${versionState(version)})${DRY ? ' · dry run' : ''}`);

const sizeOf = (file) => { const { width, height } = pngSize(readFileSync(file)); return `${width}x${height}`; };

async function uploadOne(set, file) {
  const up = await uploadAsset({
    path: '/v1/appScreenshots', type: 'appScreenshots', file,
    relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
  });
  return { id: up.id, state: await waitAsset('/v1/appScreenshots', up.id, 180) };
}

async function syncSet(locale, loc, kind) {
  const T = TYPES[kind];
  const folder = join(DIR, T.folder, SOURCES[locale]);
  const files = pngs(folder);
  const tag = `${locale} ${T.type}`;
  if (!files.length) { info(`${tag}: no files in ${folder}, skipped`); return; }
  const bad = files.filter((f) => !T.sizes.includes(sizeOf(join(folder, f))));
  if (bad.length) { warn(`${tag}: wrong size (need ${T.sizes.join(' or ')}): ${bad.join(', ')}`); failures.push(tag); return; }

  let set = (await all(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data
    .find((s) => s.attributes.screenshotDisplayType === T.type);
  if (!set) {
    set = (await write('POST', '/v1/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: T.type },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } },
      },
    })).data;
    info(`${tag}: set created`);
  }
  const current = (await all(`/v1/appScreenshotSets/${set.id}/appScreenshots`)).data;

  const ids = [];
  for (const f of files) {
    const main = join(folder, f);
    const alt = T.fallback ? join(DIR, T.fallback, SOURCES[locale], f) : null;
    const sums = [md5(readFileSync(main)), ...(alt && existsSync(alt) ? [md5(readFileSync(alt))] : [])];
    const old = current.find((s) => s.attributes.fileName === f);
    if (old && sums.includes(old.attributes.sourceFileChecksum) && old.attributes.assetDeliveryState?.state !== 'FAILED') {
      info(`${tag}: = ${f} (already uploaded)`);
      ids.push(old.id);
      continue;
    }
    // Same name, new image: upload the new one first, delete the old one only once the new one is COMPLETE.
    try {
      let id, state;
      try {
        ({ id, state } = await uploadOne(set, main));
      } catch (e) {
        if (!(alt && existsSync(alt))) throw e;
        warn(`${tag}: ${f}: ${e.message}`);
        state = 'FAILED';
      }
      if (state === 'FAILED' && alt && existsSync(alt)) {
        warn(`${tag}: ${f} refused at ${sizeOf(main)}, trying ${sizeOf(alt)}`);
        if (id) await write('DELETE', `/v1/appScreenshots/${id}`);
        ({ id, state } = await uploadOne(set, alt));
      }
      info(`${tag}: + ${f} ${state}`);
      if (state === 'FAILED') { failures.push(`${tag}/${f}`); if (old) ids.push(old.id); continue; }
      if (old) await write('DELETE', `/v1/appScreenshots/${old.id}`);
      ids.push(id);
    } catch (e) {
      warn(`${tag}: ${f}: ${e.message}`);
      failures.push(`${tag}/${f}`);
      if (old) ids.push(old.id); // keep the old screenshot in place
    }
  }

  const extra = current.filter((s) => !files.includes(s.attributes.fileName));
  if (extra.length && flag('replace')) {
    for (const s of extra) await write('DELETE', `/v1/appScreenshots/${s.id}`);
    info(`${tag}: removed ${extra.length} screenshot(s) not in the folder`);
  } else if (extra.length) {
    info(`${tag}: kept ${extra.length} older screenshot(s) not in the folder (use --replace to remove them)`);
    ids.push(...extra.map((s) => s.id));
  }
  if (!DRY && ids.length) {
    await asc('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
      data: ids.map((id) => ({ type: 'appScreenshots', id })),
    }).catch((e) => warn(`${tag}: could not reorder: ${e.message}`));
  }
}

// ─── App Store screenshots ───────────────────────────────────────────────────────────────────────
const locales = list('locales') ?? Object.keys(SOURCES);
const kinds = list('types') ?? Object.keys(TYPES);
const locs = (await all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data;
if (!EDITABLE.has(versionState(version))) {
  warn('version not editable (in review or live): App Store screenshots skipped');
} else {
  step(`App Store screenshots: ${locales.join(', ')} × ${kinds.join(', ')}`);
  const jobs = [];
  for (const locale of locales) {
    if (!SOURCES[locale]) { warn(`${locale}: not in the listing, skipped`); continue; }
    const loc = locs.find((l) => l.attributes.locale === locale);
    if (!loc) { warn(`${locale}: no version localization; run store-setup.mjs first`); failures.push(locale); continue; }
    for (const kind of kinds) {
      if (!TYPES[kind]) { warn(`unknown type ${kind}`); continue; }
      jobs.push([locale, loc, kind]);
    }
  }
  // At most 2 sets at a time: Apple rate-limits bursts (asc.mjs also retries 429s).
  await pool(jobs, 2, ([locale, loc, kind]) => attempt(`${locale} ${kind}`, () => syncSet(locale, loc, kind)));
}

// ─── Review screenshot of every product ──────────────────────────────────────────────────────────
if (!flag('no-review') && L.products?.length) {
  const shot = typeof flag('review-shot') === 'string' ? flag('review-shot') : join(DIR, get('screenshots.reviewShot', 'review/paywall.png'));
  step(`in-app purchase review screenshot: ${shot}`);
  if (!existsSync(shot)) {
    warn('missing review screenshot');
    failures.push('review screenshot');
  } else {
    const sum = md5(readFileSync(shot));
    const ids = new Set(L.products.map((p) => p.productId));
    const targets = [];
    for (const x of (await all(`/v1/apps/${APP}/inAppPurchasesV2?limit=200`)).data) {
      if (!ids.has(x.attributes.productId)) continue;
      targets.push({
        name: x.attributes.productId,
        current: `/v2/inAppPurchases/${x.id}/appStoreReviewScreenshot`,
        path: '/v1/inAppPurchaseAppStoreReviewScreenshots', type: 'inAppPurchaseAppStoreReviewScreenshots',
        relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: x.id } } },
      });
    }
    for (const g of (await all(`/v1/apps/${APP}/subscriptionGroups?limit=50`)).data) {
      for (const s of (await all(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=50`)).data) {
        if (!ids.has(s.attributes.productId)) continue;
        targets.push({
          name: s.attributes.productId,
          current: `/v1/subscriptions/${s.id}/appStoreReviewScreenshot`,
          path: '/v1/subscriptionAppStoreReviewScreenshots', type: 'subscriptionAppStoreReviewScreenshots',
          relationships: { subscription: { data: { type: 'subscriptions', id: s.id } } },
        });
      }
    }
    if (targets.length < ids.size) warn(`found ${targets.length} of ${ids.size} products: run store-setup.mjs first`);
    for (const t of targets) {
      await attempt(t.name, async () => {
        const cur = (await maybe(t.current))?.data;
        if (cur && cur.attributes.sourceFileChecksum === sum && cur.attributes.assetDeliveryState?.state !== 'FAILED') {
          return info(`= ${t.name}: already has this screenshot`);
        }
        if (cur) await write('DELETE', `${t.path}/${cur.id}`); // a product holds one review screenshot
        const up = await uploadAsset({ path: t.path, type: t.type, relationships: t.relationships, file: shot });
        const state = await waitAsset(t.path, up.id, 180);
        info(`+ ${t.name}: ${state}`);
        if (state === 'FAILED') failures.push(t.name);
      });
    }
  }
}

// ─── Check what Apple now holds ──────────────────────────────────────────────────────────────────
if (!DRY) {
  step('check');
  for (const locale of locales) {
    const loc = locs.find((l) => l.attributes.locale === locale);
    if (!loc) continue;
    for (const s of (await all(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data) {
      const shots = (await all(`/v1/appScreenshotSets/${s.id}/appScreenshots`)).data;
      const done = shots.filter((x) => x.attributes.assetDeliveryState?.state === 'COMPLETE').length;
      info(`${locale} ${s.attributes.screenshotDisplayType}: ${shots.length} screenshot(s), ${done} COMPLETE`);
      if (done !== shots.length) failures.push(`${locale} ${s.attributes.screenshotDisplayType} not all COMPLETE`);
    }
  }
}

finish(`App Store Connect → iOS App ${version.attributes.versionString} → Previews and Screenshots.`);
