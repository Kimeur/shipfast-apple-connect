// Shared helpers for the release scripts. Built on asc.mjs and config.mjs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { asc } from './asc.mjs';
import { config, get, need, ROOT, rootPath } from './config.mjs';

export { config, get, need, ROOT, rootPath };

export const argv = process.argv.slice(2);
export const DRY = argv.includes('--dry');
/** Value of `--name value` or `--name=value`; `true` for a bare flag; else `fallback`. */
export function flag(name, fallback = undefined) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  if (argv[i].includes('=')) return argv[i].split('=').slice(1).join('=');
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}
export const list = (name) => (typeof flag(name) === 'string' ? flag(name).split(',').filter(Boolean) : null);

export const step = (m) => console.log(`\n→ ${m}`);
export const info = (m) => console.log(`   ${m}`);
export const warn = (m) => console.log(`   ! ${m}`);
export const rel = (type, id) => ({ data: { type, id } });

/** Collects failed steps so a script can carry on, then report and exit 1 at the end. */
export function failureLog() {
  const failures = [];
  return {
    failures,
    async attempt(label, fn) {
      try {
        return await fn();
      } catch (e) {
        warn(`FAILED: ${label}\n     ${e.message}`);
        failures.push(label);
        return undefined;
      }
    },
    finish(done = 'Done.') {
      if (failures.length) {
        console.log(`\n${failures.length} step(s) failed:\n  - ${failures.join('\n  - ')}\nFix and re-run: finished steps are skipped.`);
        process.exit(1);
      }
      console.log(`\n${DRY ? '(dry run: nothing was written) ' : ''}${done}`);
    },
  };
}

// In --dry mode, writes are printed and return a fake resource with id "DRY".
// Reads of paths that contain a fake id return nothing, so the script can walk every step.
const isFake = (path) => String(path).includes('DRY');

/** GET that returns null on 404 (and on fake ids in dry mode). */
export async function maybe(path) {
  if (isFake(path)) return null;
  try {
    return await asc('GET', path);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** GET every page of a list endpoint (follows links.next). Returns { data, included }. */
export async function all(path) {
  if (isFake(path)) return { data: [], included: [] };
  const data = [];
  const included = [];
  let next = path;
  while (next) {
    const r = await asc('GET', next);
    data.push(...(r.data ?? []));
    included.push(...(r.included ?? []));
    next = r.links?.next ?? null;
  }
  return { data, included };
}

/** Like all(), but a 404 (nothing there yet) gives an empty list. */
export async function allOrEmpty(path) {
  try {
    return await all(path);
  } catch (e) {
    if (e.status === 404) return { data: [], included: [] };
    throw e;
  }
}

/** POST/PATCH/DELETE, or print it in dry mode. */
export async function write(method, path, body) {
  if (DRY) {
    info(`(dry) ${method} ${path}`);
    return { data: { id: 'DRY', type: body?.data?.type, attributes: body?.data?.attributes ?? {} } };
  }
  return asc(method, path, body);
}

/** True when every key of `b` has the same value in `a` (missing counts as null). */
export const same = (a, b) => Object.keys(b).every((k) => (a?.[k] ?? null) === (b[k] ?? null));

/** The app's App Store Connect id, from the config, checked against the bundle ID. */
export async function appId() {
  const bundle = need('app.bundleId');
  const want = get('app.appId');
  const r = await asc('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(bundle)}`);
  const app = r.data.find((a) => a.attributes.bundleId === bundle);
  if (!app) {
    throw new Error(`No app record with bundle ID ${bundle} in App Store Connect. Create it on the web first (manual step M3 in references/manual-steps.md), then set app.appId.`);
  }
  if (want && String(want) !== app.id) warn(`bundle ID ${bundle} points at app ${app.id}, config says ${want}`);
  if (!want) warn(`app.appId is not set in ship.config.json: it is ${app.id}`);
  return app.id;
}

/** Every territory id Apple knows, and the ones the app is sold in (config territories.exclude removed). */
export async function territories() {
  const allIds = (await all('/v1/territories?limit=200')).data.map((t) => t.id);
  const exclude = new Set(get('territories.exclude', []));
  return { all: allIds, sold: allIds.filter((t) => !exclude.has(t)), exclude };
}

// App Store version states in which metadata can still be edited.
export const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'READY_FOR_REVIEW', // in a draft review submission, not sent yet
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);
export const versionState = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState;

/** The marketing version the build carries (MARKETING_VERSION in the Xcode project, e.g. "1.0"). */
export function appVersion() {
  if (get('app.version')) return String(get('app.version'));
  const proj = rootPath(need('xcode.project'));
  const pbx = readFileSync(join(proj, 'project.pbxproj'), 'utf8');
  const v = pbx.match(/MARKETING_VERSION = ([^;]+);/);
  if (!v) throw new Error(`MARKETING_VERSION not found in ${proj}/project.pbxproj (or set app.version)`);
  return v[1].trim().replace(/"/g, '');
}

/**
 * The iOS App Store version to work on: --version, else the build's version, else the editable one
 * (a new app record starts with "1.0"). Returns null if there is none.
 */
export async function iosVersion(app) {
  const explicit = typeof flag('version') === 'string';
  const want = explicit ? flag('version') : appVersion();
  const versions = (await asc('GET', `/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&limit=20`)).data;
  const exact = versions.find((v) => v.attributes.versionString === want);
  // An explicit --version never falls back to another version: create it first (web or POST /v1/appStoreVersions).
  if (explicit) return exact ?? null;
  return exact ?? versions.find((v) => EDITABLE.has(versionState(v))) ?? null;
}

export const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/** Width and height of a PNG, read from its header. */
export function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export const pngs = (folder, max = 10) =>
  (existsSync(folder) ? readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.png')).sort().slice(0, max) : []);

/**
 * Apple asset upload: reserve (POST) → PUT each upload operation → commit (PATCH uploaded + md5).
 * `type` is the resource type (e.g. appScreenshots), `path` its collection path (e.g. /v1/appScreenshots).
 */
export async function uploadAsset({ path, type, relationships, file, attributes = {}, checksum = true }) {
  const bytes = readFileSync(file);
  const fileName = basename(file);
  if (DRY) {
    info(`(dry) upload ${fileName} (${(statSync(file).size / 1024).toFixed(0)} KB) → ${path}`);
    return { id: 'DRY' };
  }
  const reserved = (await asc('POST', path, {
    data: { type, attributes: { ...attributes, fileName, fileSize: bytes.length }, relationships },
  })).data;
  for (const op of reserved.attributes.uploadOperations ?? []) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`upload ${fileName} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  // The checksum is required: without it Apple leaves the asset waiting forever.
  await asc('PATCH', `${path}/${reserved.id}`, {
    data: { type, id: reserved.id, attributes: { uploaded: true, ...(checksum ? { sourceFileChecksum: md5(bytes) } : {}) } },
  });
  return reserved;
}

/** Poll an asset until Apple has processed it; returns its final delivery state. */
export async function waitAsset(path, id, seconds = 90) {
  if (DRY || id === 'DRY') return 'DRY';
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const a = (await asc('GET', `${path}/${id}`)).data;
    const st = a.attributes.assetDeliveryState ?? {};
    if (st.state === 'COMPLETE' || st.state === 'FAILED' || Date.now() > until) {
      if (st.state === 'FAILED') warn(`${a.attributes.fileName}: FAILED ${JSON.stringify(st.errors ?? [])}`);
      return st.state ?? 'UNKNOWN';
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Run async jobs with a small concurrency limit (Apple rate-limits bursts). */
export async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The listing module named by `listing` in the config (default ship/listing.mjs). */
export async function readListing() {
  const p = rootPath(get('listing', 'ship/listing.mjs'));
  if (!existsSync(p)) throw new Error(`listing not found: ${p} (copy templates/listing.example.mjs)`);
  return (await import(pathToFileURL(p).href)).default;
}

/** Products of every kind in App Store Connect: [{ kind: 'iap'|'subscription', resource }]. */
export async function storeProducts(app) {
  const items = [];
  for (const x of (await all(`/v1/apps/${app}/inAppPurchasesV2?limit=200`)).data) items.push({ kind: 'iap', resource: x });
  for (const g of (await all(`/v1/apps/${app}/subscriptionGroups?limit=50`)).data) {
    for (const s of (await all(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=50`)).data) items.push({ kind: 'subscription', resource: s, group: g });
  }
  return items;
}
