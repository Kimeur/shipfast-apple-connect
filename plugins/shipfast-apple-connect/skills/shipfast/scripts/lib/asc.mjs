// Minimal App Store Connect API client: an ES256 JWT signed with your API key, retries on 429.
//
// The key never goes in ship.config.json. It comes from, first match wins:
//   $ASC_KEY_ID, $ASC_ISSUER_ID, $ASC_KEY_PATH (environment), or
//   "ascKey": { "keyId", "issuerId", "keyPath" } in ship.local.json (gitignored).
// keyPath defaults to ~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8, where altool also looks.
//
// Usage: node asc.mjs <METHOD> <path> [json-body | @file.json]
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { config } from './config.mjs';

export function credentials() {
  const k = config.ascKey ?? {};
  const keyId = process.env.ASC_KEY_ID ?? k.keyId;
  const issuerId = process.env.ASC_ISSUER_ID ?? k.issuerId;
  const keyPath = (process.env.ASC_KEY_PATH ?? k.keyPath ?? `~/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`)
    .replace(/^~(?=\/)/, homedir());
  if (!keyId || !issuerId) throw new Error('App Store Connect key not set: export ASC_KEY_ID and ASC_ISSUER_ID, or fill "ascKey" in ship.local.json.');
  if (!existsSync(keyPath)) throw new Error(`API key file not found: ${keyPath} (set ASC_KEY_PATH)`);
  return { keyId, issuerId, keyPath };
}

let cached;
const b64u = (b) => Buffer.from(b).toString('base64url');
export function jwt() {
  cached ??= (() => { const c = credentials(); return { ...c, key: createPrivateKey(readFileSync(c.keyPath)) }; })();
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: cached.keyId, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: cached.issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: cached.key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

export const API = process.env.ASC_API_BASE ?? 'https://api.appstoreconnect.apple.com';

export async function asc(method, path, body) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  let res;
  // Apple answers 429 when requests come too fast: wait and try again (up to 6 times, 10 s, 20 s, ...).
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429 || attempt > 6) break;
    await new Promise((r) => setTimeout(r, 10_000 * attempt));
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    err.status = res.status; err.json = json; throw err;
  }
  return json;
}

/** Apple error codes in a failed call, e.g. ["STATE_ERROR.FIRST_SUBSCRIPTION_MUST_BE_SUBMITTED_ON_VERSION"]. */
export const errorCodes = (e) => (e?.json?.errors ?? []).map((x) => x.code).filter(Boolean);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--config');
  const [method, path, raw] = pos;
  if (!method || !path) {
    console.error('usage: node asc.mjs <GET|POST|PATCH|DELETE> <path> [json | @file.json]');
    process.exit(2);
  }
  if (method !== 'GET' && process.argv.includes('--dry')) {
    console.log(`(dry) ${method} ${path}${raw ? ` ${raw.slice(0, 200)}` : ''}`);
    process.exit(0);
  }
  if (method !== 'GET' && !process.argv.includes('--yes')) {
    console.error(`${method} writes to App Store Connect. Re-run with --yes once the owner agreed.`);
    process.exit(2);
  }
  const body = raw ? JSON.parse(raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw) : undefined;
  asc(method, path, body)
    .then((j) => console.log(JSON.stringify(j, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
