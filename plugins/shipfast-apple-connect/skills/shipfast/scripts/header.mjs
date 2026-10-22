// Product page header and search results assets, through the app asset library API.
// Uploads <screenshots.dir>/header/<source>/{header,search}.png once per source into the app's asset library
// (category CREATIVE_ASSETS), then places them on each version localization. Safe to re-run: an existing
// placement is kept. Images: store-header.py.
// The version must not sit in a draft review submission (Apple refuses edits there: take it out first).
//
// Usage: node header.mjs [--dry] [--only=header|search] [--version=1.0.1]
// Config: header.localeSources maps each locale to the folder whose files it gets (default: screenshots.localeSources).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { asc } from './lib/asc.mjs';
import {
  DRY, EDITABLE, all, appId, failureLog, flag, get, info, readListing, rel, requireVersion, rootPath, step, uploadAsset,
  versionState, warn, write,
} from './lib/util.mjs';

const DIR = join(rootPath(get('screenshots.dir', 'Launch/store-screens')), 'header');
const L = await readListing();
const source = (l) => get(`header.localeSources.${l}`) ?? get(`screenshots.localeSources.${l}`, l);
const { attempt, finish } = failureLog();

const APP = await appId();
const version = await requireVersion(APP);
console.log(`${get('app.name')} ${APP} · version ${version.attributes.versionString} (${versionState(version)})${DRY ? ' · dry run' : ''}`);
if (!EDITABLE.has(versionState(version))) {
  console.log('Version not editable (in review or live): nothing placed. Create the next version, then run with --version=<it>.');
  process.exit(DRY ? 0 : 1);
}
const locs = (await all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)).data;
const uploaded = {};
// header.png is 21:9 (3840x1646), search.png 3:2 (3840x2560).
const SPECS = { PRODUCT_PAGE_HEADER_ASSET: 'header.png', APP_STORE_SEARCH_RESULTS_ASSET: 'search.png' };
const only = flag('only');
const types = Object.keys(SPECS).filter((t) => !only || (only === 'search') === (t === 'APP_STORE_SEARCH_RESULTS_ASSET'));

for (const locale of Object.keys(L.locales)) {
  const loc = locs.find((l) => l.attributes.locale === locale);
  if (!loc) { warn(`${locale}: no localization`); continue; }
  const have = (await all(`/v1/appStoreVersionLocalizations/${loc.id}/placements?limit=200`)).data;
  for (const placementType of types) {
    step(`${locale} ${placementType}`);
    if (have.some((p) => p.attributes.placementType === placementType)) { info('already placed'); continue; }
    const key = `${source(locale)}/${SPECS[placementType]}`;
    await attempt(`${locale} ${placementType}`, async () => {
      if (!uploaded[key]) {
        const file = join(DIR, key);
        if (!existsSync(file)) throw new Error(`missing ${file}`);
        const img = await uploadAsset({
          path: '/v1/appAssetLibraryImages', type: 'appAssetLibraryImages', file,
          relationships: { assetLibrary: rel('appAssetLibraries', APP) },
          attributes: { category: 'CREATIVE_ASSETS' }, checksum: false, // library images take no checksum
        });
        // Library images report attributes.state (not assetDeliveryState): wait until Apple has processed it.
        let state = 'DRY';
        for (let i = 0; i < 40 && !DRY; i++) {
          const a = (await asc('GET', `/v1/appAssetLibraryImages/${img.id}`)).data.attributes;
          state = a.state;
          if (!['UPLOADING', 'PROCESSING', 'AWAITING_UPLOAD', 'UPLOAD_COMPLETE'].includes(state)) { if (a.stateDetails) warn(JSON.stringify(a.stateDetails)); break; }
          await new Promise((r) => setTimeout(r, 3000));
        }
        info(`uploaded ${key} → ${state}`);
        uploaded[key] = img.id;
      }
      await write('POST', '/v1/appAssetLibraryPlacements', {
        data: {
          type: 'appAssetLibraryPlacements',
          attributes: { placementType },
          relationships: { appStoreVersionLocalization: rel('appStoreVersionLocalizations', loc.id), image: rel('appAssetLibraryImages', uploaded[key]) },
        },
      });
      info('placed');
    });
  }
}
finish();
