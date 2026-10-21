// A fake App Store Connect for the tests, loaded with `node --import ./mock-asc.mjs`.
// It replaces fetch: nothing leaves the machine. Every request is appended to $MOCK_LOG as one JSON line.
// $MOCK_SCENARIO (JSON) shapes the answers: { products: [...], firstProductError, availability, priced, build, ... }.
import { appendFileSync } from 'node:fs';

const S = JSON.parse(process.env.MOCK_SCENARIO ?? '{}');
const LOG = process.env.MOCK_LOG;
const TERRITORIES = ['FRA', 'USA', 'DEU', 'CHN'];
let seq = 0;
const id = (p) => `${p}${++seq}`;
const ok = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => ok({ errors: [{ status: '404', code: 'NOT_FOUND' }] }, 404);
const list = (data) => ok({ data, links: {} });

const products = (S.products ?? []).map((p, i) => ({
  id: `${p.kind === 'iap' ? 'iap' : 'sub'}${i}`,
  type: p.kind === 'iap' ? 'inAppPurchases' : 'subscriptions',
  kind: p.kind,
  attributes: { productId: p.productId, state: p.state ?? 'READY_TO_SUBMIT', name: p.referenceName ?? p.productId },
}));
// Price points: FRA customer prices; equalizations give every other territory, CHN included.
const point = (t, price) => ({ id: Buffer.from(JSON.stringify({ t, p: price })).toString('base64url'), type: 'subscriptionPricePoints', attributes: { customerPrice: price }, relationships: { territory: { data: { type: 'territories', id: t } } } });

function route(method, url, body) {
  const u = new URL(url);
  const p = u.pathname;
  const q = Object.fromEntries(u.searchParams);
  if (method === 'GET') {
    if (p === '/v1/apps') return list(S.noApp ? [] : [{ id: 'APP1', type: 'apps', attributes: { bundleId: q['filter[bundleId]'], name: 'Test App' } }]);
    if (p === '/v1/territories') return list(TERRITORIES.map((t) => ({ id: t, type: 'territories' })));
    if (p === '/v1/apps/APP1/appInfos') return list([{ id: 'AI1', type: 'appInfos', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }]);
    if (p === '/v1/appInfos/AI1/ageRatingDeclaration') return ok({ data: { id: 'AR1', type: 'ageRatingDeclarations' } });
    if (p === '/v1/apps/APP1/appStoreVersions') return list([{ id: 'V1', type: 'appStoreVersions', attributes: { versionString: '1.0', appStoreState: 'PREPARE_FOR_SUBMISSION', appVersionState: 'PREPARE_FOR_SUBMISSION' } }]);
    if (p === '/v1/apps/APP1/appAvailabilityV2') return S.availability ? ok({ data: { id: 'AV1', type: 'appAvailabilities' } }) : notFound();
    if (p === '/v2/appAvailabilities/AV1/territoryAvailabilities') return list(TERRITORIES.map((t) => ({ id: `TA-${t}`, type: 'territoryAvailabilities', attributes: { available: true }, relationships: { territory: { data: { type: 'territories', id: t } } } })));
    if (p === '/v1/apps/APP1/appPriceSchedule') return ok({ data: { id: 'PS1', type: 'appPriceSchedules' } }); // a new app: a schedule with no price
    if (p === '/v1/appPriceSchedules/PS1/manualPrices') return list(S.priced ? [{ id: 'MP1' }] : []);
    if (p === '/v1/apps/APP1/appPricePoints') return list([{ id: 'APP-FREE', attributes: { customerPrice: '0.0' } }, { id: 'APP-099', attributes: { customerPrice: '0.99' } }]);
    if (p === '/v1/apps/APP1/inAppPurchasesV2') return list(products.filter((x) => x.kind === 'iap'));
    if (p === '/v1/apps/APP1/subscriptionGroups') return list(products.some((x) => x.kind === 'subscription') ? [{ id: 'G1', type: 'subscriptionGroups', attributes: { referenceName: 'My App Pro' } }] : []);
    if (p === '/v1/subscriptionGroups/G1/subscriptions') return list(products.filter((x) => x.kind === 'subscription'));
    if (/^\/v1\/subscriptionGroups\/[^/]+\/subscriptions$/.test(p)) return list([]);
    if (/^\/v[12]\/(inAppPurchases|subscriptions)\/[^/]+\/pricePoints$/.test(p)) {
      return list(['2.99', '19.99', '39.99'].map((pr) => point(q['filter[territory]'] ?? 'FRA', pr)));
    }
    if (/^\/v1\/subscriptionPricePoints\/[^/]+\/equalizations$/.test(p)) return list(TERRITORIES.filter((t) => t !== 'FRA').map((t) => point(t, '1')));
    if (p === '/v1/builds') return list(S.build === false ? [] : [{ id: 'B1', type: 'builds', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: false } }]);
    if (p === '/v1/appStoreVersions/V1/build') return ok({ data: null });
    if (p === '/v1/appStoreVersions/V1/appStoreVersionLocalizations') return list([{ id: 'LOC-en', attributes: { locale: 'en-US' } }]);
    if (p === '/v1/appStoreVersionLocalizations/LOC-en/appScreenshotSets') return list(S.screenshots === false ? [] : [{ id: 'SET1', attributes: { screenshotDisplayType: 'APP_IPHONE_67' } }, { id: 'SET1', attributes: { screenshotDisplayType: 'APP_IPAD_PRO_3GEN_129' } }]);
    if (p === '/v1/appScreenshotSets/SET1/appScreenshots') return list([{ id: 'SS1' }]);
    if (p === '/v1/appStoreVersions/V1/appStoreReviewDetail') return ok({ data: { id: 'RD1', attributes: { contactFirstName: 'A', contactLastName: 'B', contactPhone: '+1', contactEmail: 'a@example.com', notes: 'notes' } } });
    if (p === '/v1/reviewSubmissions') return list(S.draft ? [{ id: 'RS-DRAFT', type: 'reviewSubmissions' }] : []);
    if (p.endsWith('/appStoreReviewScreenshot')) return ok({ data: { id: 'RSS' } });
    if (p === '/v1/reviewSubmissions/RS-DRAFT/items') {
      // The draft holds the version, plus the products listed in S.inDraft (by index into S.products).
      return list([{ id: 'I0', relationships: { appStoreVersion: { data: { id: 'V1' } } } },
        ...(S.inDraft ?? []).map((i) => ({ id: `I${i + 1}`, relationships: { [products[i].kind === 'iap' ? 'inAppPurchaseV2' : 'subscription']: { data: { id: products[i].id } } } }))]);
    }
    if (/\/(prices|subscriptionLocalizations)$/.test(p) && S.completeFirstSub) return list([{ id: 'X1' }]);
    // Everything else: an empty list (nothing there yet). Single resources answer 404.
    if (/\/(versions|localizations|appInfoLocalizations|appStoreVersionLocalizations|prices|introductoryOffers|manualPrices|availableTerritories|planAvailabilities|items|placements|subscriptionLocalizations|inAppPurchaseLocalizations|bundleIds|profiles|certificates)$/.test(p)) return list([]);
    return notFound();
  }
  // Writes
  if (S.firstProductError && /\/(subscriptionSubmissions|inAppPurchaseSubmissions)$/.test(p)) {
    return ok({ errors: [{ status: '409', code: 'STATE_ERROR.FIRST_SUBSCRIPTION_MUST_BE_SUBMITTED_ON_VERSION', detail: 'first subscription' }] }, 409);
  }
  if (method === 'POST') {
    const type = body?.data?.type ?? 'thing';
    return ok({ data: { id: id(type.slice(0, 4).toUpperCase()), type, attributes: { ...(body?.data?.attributes ?? {}), state: 'MISSING_METADATA' } } }, 201);
  }
  if (method === 'PATCH') return ok({ data: body?.data ?? null });
  if (method === 'DELETE') return ok(null, 204);
  return notFound();
}

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (!String(url).startsWith('https://api.appstoreconnect.apple.com')) throw new Error(`mock: unexpected host ${url}`);
  if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(init.headers?.Authorization ?? '')) throw new Error('mock: missing or malformed JWT');
  if (LOG) appendFileSync(LOG, `${JSON.stringify({ method, path: new URL(url).pathname + new URL(url).search, body })}\n`);
  return route(method, url, body);
};
