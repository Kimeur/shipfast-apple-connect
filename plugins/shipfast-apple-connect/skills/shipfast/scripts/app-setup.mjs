// App-level settings through the API: availability, app price, age rating, categories, content rights.
// Re-runnable: availability and price are created only when missing; app info is patched only where it differs
// from the config, and only while App Store Connect lets it be edited (not while a version is in review).
//
// Usage: node app-setup.mjs [--dry] [--only=availability,price,age,categories,rights] [--confirm-prices]
//
// Rules this encodes (learned shipping Fold Days, Oct 2026):
// - A new appAvailabilities resource must list EVERY territory; excluded ones are listed with available: false.
// - A new app has an empty price schedule (no manual price): even a free app must POST one.
// - A paid app price is a price decision: it needs --confirm-prices, like store-setup.mjs.
import { asc } from './lib/asc.mjs';
import {
  DRY, EDITABLE, appId, failureLog, flag, get, info, list, maybe, need, rel, same, step, territories, warn, write,
} from './lib/util.mjs';

const ONLY = list('only') ? new Set(list('only')) : null;
const want = (s) => !ONLY || ONLY.has(s);
const { attempt, finish } = failureLog();

const APP = await appId();
console.log(`${need('app.name')} · app ${APP}${DRY ? '  (dry run: nothing is written)' : ''}`);
const T = await territories();
const BASE = need('baseTerritory');

if (want('availability')) {
  step(`availability: ${T.sold.length} territories${T.exclude.size ? `, closed: ${[...T.exclude].join(', ')}` : ''}`);
  await attempt('availability', async () => {
    const av = await maybe(`/v1/apps/${APP}/appAvailabilityV2`);
    if (!av?.data) {
      const r = await write('POST', '/v2/appAvailabilities', {
        data: {
          type: 'appAvailabilities',
          attributes: { availableInNewTerritories: Boolean(get('territories.availableInNewTerritories', true)) },
          relationships: {
            app: rel('apps', APP),
            territoryAvailabilities: { data: T.all.map((t) => ({ type: 'territoryAvailabilities', id: `\${${t}}` })) },
          },
        },
        included: T.all.map((t) => ({
          type: 'territoryAvailabilities', id: `\${${t}}`,
          attributes: { available: !T.exclude.has(t) },
          relationships: { territory: rel('territories', t) },
        })),
      });
      return info(`created (${r.data.id}): ${T.sold.length} open, ${T.exclude.size} closed`);
    }
    // Exists (for example opened from the web UI): close the excluded territories that are open.
    const terr = (await asc('GET', `/v2/appAvailabilities/${av.data.id}/territoryAvailabilities?include=territory&limit=200`)).data;
    let closed = 0;
    for (const t of terr) {
      const id = t.relationships?.territory?.data?.id;
      if (T.exclude.has(id) && t.attributes.available) {
        await write('PATCH', `/v1/territoryAvailabilities/${t.id}`, { data: { type: 'territoryAvailabilities', id: t.id, attributes: { available: false } } });
        closed++;
      }
    }
    info(`exists (${av.data.id})${closed ? `: closed ${closed} excluded territories` : ''}`);
  });
}

if (want('price')) {
  const price = String(get('appPrice', '0'));
  step(`app price: ${Number(price) === 0 ? 'free' : `${price} (${BASE})`}`);
  await attempt('app price', async () => {
    const sched = await maybe(`/v1/apps/${APP}/appPriceSchedule`);
    const priced = sched?.data && (await asc('GET', `/v1/appPriceSchedules/${sched.data.id}/manualPrices?limit=1`)).data.length > 0;
    if (priced) return info(`exists (${sched.data.id}): left as is`);
    if (Number(price) !== 0 && flag('confirm-prices') !== true) {
      return warn(`paid app: would set ${price} in ${BASE}. Not set: owner approval needed, then re-run with --confirm-prices`);
    }
    const points = (await asc('GET', `/v1/apps/${APP}/appPricePoints?filter[territory]=${BASE}&limit=200`)).data;
    const point = points.find((p) => Number(p.attributes.customerPrice) === Number(price));
    if (!point) throw new Error(`no ${BASE} app price point at ${price}`);
    const r = await write('POST', '/v1/appPriceSchedules', {
      data: {
        type: 'appPriceSchedules',
        relationships: {
          app: rel('apps', APP),
          baseTerritory: rel('territories', BASE),
          manualPrices: { data: [{ type: 'appPrices', id: '${price}' }] },
        },
      },
      included: [{
        type: 'appPrices', id: '${price}',
        attributes: { startDate: null },
        relationships: { appPricePoint: rel('appPricePoints', point.id) },
      }],
    });
    info(`set (${r.data.id})`);
  });
}

const infos = (await asc('GET', `/v1/apps/${APP}/appInfos?include=primaryCategory,secondaryCategory`)).data;
const ai = infos.find((i) => !['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(i.attributes.state ?? i.attributes.appStoreState)) ?? infos[0];
const aiState = ai.attributes.state ?? ai.attributes.appStoreState;
/** Patch the app info only if it can be edited now; otherwise say what would change. */
const lockedInfo = (what) => {
  if (EDITABLE.has(aiState)) return false;
  warn(`app info is ${aiState}: not editable now, ${what} left as is. Re-run once the next version is created.`);
  return true;
};

if (want('age')) {
  // Default: nothing objectionable (4+). Override any answer under "ageRating" in the config.
  // Answer each question truthfully for your app: this is a declaration to Apple.
  const NONE = 'NONE';
  const answers = {
    advertising: false, alcoholTobaccoOrDrugUseOrReferences: NONE, contests: NONE, gambling: false, gamblingSimulated: NONE,
    gunsOrOtherWeapons: NONE, healthOrWellnessTopics: false, lootBox: false, medicalOrTreatmentInformation: NONE,
    messagingAndChat: false, parentalControls: false, profanityOrCrudeHumor: NONE, ageAssurance: false,
    sexualContentGraphicAndNudity: NONE, sexualContentOrNudity: NONE, socialMedia: false, socialMediaAgeRestricted: false,
    horrorOrFearThemes: NONE, matureOrSuggestiveThemes: NONE, unrestrictedWebAccess: false, userGeneratedContent: false,
    violenceCartoonOrFantasy: NONE, violenceRealisticProlongedGraphicOrSadistic: NONE, violenceRealistic: NONE,
    ...get('ageRating', {}),
  };
  step('age rating');
  await attempt('age rating', async () => {
    const ar = (await asc('GET', `/v1/appInfos/${ai.id}/ageRatingDeclaration`)).data;
    if (same(ar.attributes, answers)) return info('up to date');
    if (lockedInfo('age rating')) return;
    await write('PATCH', `/v1/ageRatingDeclarations/${ar.id}`, { data: { type: 'ageRatingDeclarations', id: ar.id, attributes: answers } });
    info(`set (${Object.keys(get('ageRating', {})).length} answers overridden by the config)`);
  });
}

if (want('categories')) {
  const primary = need('categories.primary');
  const secondary = get('categories.secondary');
  step(`categories: ${primary}${secondary ? `, then ${secondary}` : ''}`);
  await attempt('categories', async () => {
    const cat = (k) => ai.relationships?.[k]?.data?.id ?? null;
    if (cat('primaryCategory') === primary && (!secondary || cat('secondaryCategory') === secondary)) return info('up to date');
    if (lockedInfo('categories')) return;
    await write('PATCH', `/v1/appInfos/${ai.id}`, { data: { type: 'appInfos', id: ai.id, relationships: {
      primaryCategory: rel('appCategories', primary),
      ...(secondary ? { secondaryCategory: rel('appCategories', secondary) } : {}),
    } } });
    info('set');
  });
}

if (want('rights')) {
  const rights = get('contentRights', 'DOES_NOT_USE_THIRD_PARTY_CONTENT');
  step(`content rights: ${rights}`);
  await attempt('content rights', async () => {
    const app = (await asc('GET', `/v1/apps/${APP}?fields[apps]=contentRightsDeclaration`)).data;
    if (app.attributes?.contentRightsDeclaration === rights) return info('up to date');
    await write('PATCH', `/v1/apps/${APP}`, { data: { type: 'apps', id: APP, attributes: { contentRightsDeclaration: rights } } });
    info('set');
  });
}

finish();
