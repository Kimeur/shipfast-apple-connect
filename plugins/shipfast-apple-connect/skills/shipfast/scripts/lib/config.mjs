// Loads the app's ship.config.json, merged with ship.local.json (private, gitignored) when it exists.
//
// Where the config is found, first match wins:
//   --config <path>, $SHIPFAST_CONFIG, then ./ship/ship.config.json or ./ship.config.json in the
//   current folder or any parent folder.
// Paths inside the config are relative to `root` (default: the folder above ship/, else the config's folder).
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';

function argValue(name) {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  if (argv[i].includes('=')) return argv[i].split('=').slice(1).join('=');
  return argv[i + 1];
}

function findConfig() {
  const explicit = argValue('config') ?? process.env.SHIPFAST_CONFIG;
  if (explicit) {
    const p = resolve(explicit);
    if (!existsSync(p)) throw new Error(`config not found: ${p}`);
    return p;
  }
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    for (const p of [join(dir, 'ship', 'ship.config.json'), join(dir, 'ship.config.json')]) if (existsSync(p)) return p;
    if (dirname(dir) === dir) break;
  }
  throw new Error('No ship.config.json found. Copy templates/ship.config.example.json to <app>/ship/ship.config.json, or pass --config <path>.');
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
export function merge(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
  return out;
}

export const CONFIG_PATH = findConfig();
export const CONFIG_DIR = dirname(CONFIG_PATH);
const base = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const localPath = join(CONFIG_DIR, 'ship.local.json');
const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : {};

export const config = merge(base, local);
export const ROOT = resolve(CONFIG_DIR, config.root ?? (CONFIG_DIR.endsWith('/ship') ? '..' : '.'));
/** A path from the config, resolved against the app root. */
export const rootPath = (p) => (isAbsolute(p) ? p : join(ROOT, p));

/** Read a dotted key ("app.bundleId"); throws with a hint when a required key is missing. */
export function need(key) {
  const v = key.split('.').reduce((o, k) => o?.[k], config);
  if (v === undefined || v === null || v === '' || (typeof v === 'string' && v.includes('REPLACE_ME'))) {
    throw new Error(`ship.config.json: "${key}" is not set (${CONFIG_PATH})`);
  }
  return v;
}
export const get = (key, fallback) => key.split('.').reduce((o, k) => o?.[k], config) ?? fallback;

// `node lib/config.mjs <key>` prints one value, for the shell scripts. Objects print as JSON.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== argValue('config'));
  if (key === 'ROOT') console.log(ROOT);
  else {
    const v = get(key);
    if (v === undefined) process.exit(3);
    console.log(typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
}
