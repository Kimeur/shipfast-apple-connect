// Runs the release scripts against a fake App Store Connect (mock-asc.mjs). Nothing leaves the machine.
// Usage: node --test tests/*.test.mjs   (Node 22 does not take a folder)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', 'scripts');
const TEMPLATES = join(HERE, '..', 'templates');

/** A throwaway app folder with a filled config, the template listing, review notes and a fake API key. */
function fixture(edit = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shipfast-'));
  mkdirSync(join(dir, 'ship'));
  mkdirSync(join(dir, 'MyApp.xcodeproj'));
  writeFileSync(join(dir, 'MyApp.xcodeproj', 'project.pbxproj'), 'MARKETING_VERSION = 1.0;\n');
  const cfg = JSON.parse(readFileSync(join(TEMPLATES, 'ship.config.example.json'), 'utf8'));
  cfg.team.teamId = 'TEAMID0000';
  cfg.app.appId = 'APP1';
  cfg.review.contact = { firstName: 'Ada', lastName: 'Example', email: 'ada@example.com', phone: '+33 1 00 00 00 00' };
  Object.assign(cfg, edit);
  writeFileSync(join(dir, 'ship', 'ship.config.json'), JSON.stringify(cfg, null, 2));
  let listing = readFileSync(join(TEMPLATES, 'listing.example.mjs'), 'utf8')
    .replaceAll('REPLACE_ME', 'Filled').replaceAll('example.com', 'example.org');
  listing = listing.replaceAll('com.example.myapp', 'com.example.myapp'); // product ids stay
  writeFileSync(join(dir, 'ship', 'listing.mjs'), listing);
  cpSync(join(TEMPLATES, 'review-notes.example.txt'), join(dir, 'ship', 'review-notes.txt'));
  writeFileSync(join(dir, '.gitignore'), 'build/\nship/ship.local.json\n');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(join(dir, 'AuthKey_TEST.p8'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return dir;
}

function run(dir, script, args = [], scenario = {}) {
  const log = join(dir, `requests-${Date.now()}-${Math.random()}.jsonl`);
  const r = spawnSync(process.execPath, ['--import', join(HERE, 'mock-asc.mjs'), join(SCRIPTS, script), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHIPFAST_CONFIG: '',
      ASC_KEY_ID: 'TEST', ASC_ISSUER_ID: '00000000-0000-0000-0000-000000000000', ASC_KEY_PATH: join(dir, 'AuthKey_TEST.p8'),
      MOCK_LOG: log, MOCK_SCENARIO: JSON.stringify(scenario),
    },
  });
  const requests = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { code: r.status, out: r.stdout + r.stderr, requests, writes: requests.filter((x) => x.method !== 'GET') };
}

const LISTED = [
  { kind: 'subscription', productId: 'com.example.myapp.pro.yearly' },
  { kind: 'subscription', productId: 'com.example.myapp.pro.monthly' },
  { kind: 'iap', productId: 'com.example.myapp.pro.lifetime' },
];

test('doctor --offline passes on a filled config and catches a long subtitle', () => {
  const dir = fixture();
  const good = run(dir, 'doctor.mjs', ['--offline']);
  assert.equal(good.code, 0, good.out);
  assert.equal(good.requests.length, 0, 'offline made API calls');
  const p = join(dir, 'ship', 'listing.mjs');
  writeFileSync(p, readFileSync(p, 'utf8').replace("subtitle: 'Filled: the promise, 30 max'", "subtitle: 'This subtitle is far too long for the App Store'"));
  const bad = run(dir, 'doctor.mjs', ['--offline']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /subtitle: \d+ characters, limit 30/);
});

test('store-setup --dry writes nothing', () => {
  const r = run(fixture(), 'store-setup.mjs', ['--dry', '--confirm-prices']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.writes.length, 0, JSON.stringify(r.writes));
  assert.match(r.out, /\(dry\) POST \/v1\/subscriptions/);
});

test('store-setup sets no price without --confirm-prices', () => {
  const r = run(fixture(), 'store-setup.mjs', [], { products: LISTED });
  assert.equal(r.code, 0, r.out);
  const priceWrites = r.writes.filter((w) => /subscriptionPrices|inAppPurchasePriceSchedules|subscriptionIntroductoryOffers/.test(w.path));
  assert.equal(priceWrites.length, 0, JSON.stringify(priceWrites));
  assert.match(r.out, /Prices NOT set/);
});

test('store-setup --confirm-prices prices every territory, CHN included, and trials only where sold', () => {
  const r = run(fixture(), 'store-setup.mjs', ['--confirm-prices', '--only=sub'], { products: LISTED });
  assert.equal(r.code, 0, r.out);
  const priced = r.writes.filter((w) => w.path === '/v1/subscriptionPrices').map((w) => w.body.data.relationships.territory.data.id);
  for (const t of ['FRA', 'USA', 'DEU', 'CHN']) assert.ok(priced.includes(t), `no price for ${t}: ${priced}`);
  const trials = r.writes.filter((w) => w.path === '/v1/subscriptionIntroductoryOffers').map((w) => w.body.data.relationships.territory.data.id);
  assert.ok(trials.length > 0, 'no free trial written');
  assert.ok(!trials.includes('CHN'), 'free trial offered in an excluded territory');
});

test('app-setup lists every territory in a new availability and posts a free price schedule', () => {
  const r = run(fixture(), 'app-setup.mjs', ['--only=availability,price']);
  assert.equal(r.code, 0, r.out);
  const av = r.writes.find((w) => w.path === '/v2/appAvailabilities');
  assert.ok(av, 'no availability POST');
  const listed = Object.fromEntries(av.body.included.map((x) => [x.relationships.territory.data.id, x.attributes.available]));
  assert.deepEqual(listed, { FRA: true, USA: true, DEU: true, CHN: false });
  const price = r.writes.find((w) => w.path === '/v1/appPriceSchedules');
  assert.equal(price?.body.included[0].relationships.appPricePoint.data.id, 'APP-FREE');
});

test('app-setup leaves age rating, categories and content rights alone when they already match', () => {
  const dir = fixture();
  const first = run(dir, 'app-setup.mjs', ['--only=age']);
  const answers = first.writes.find((w) => w.path.startsWith('/v1/ageRatingDeclarations/'))?.body.data.attributes;
  assert.ok(answers, first.out);
  const r = run(dir, 'app-setup.mjs', ['--only=age,categories,rights'], {
    appInfo: { ageRating: answers, primaryCategory: 'LIFESTYLE', secondaryCategory: 'PRODUCTIVITY' },
    contentRights: 'DOES_NOT_USE_THIRD_PARTY_CONTENT',
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.writes.length, 0, JSON.stringify(r.writes));
  assert.equal(r.out.match(/up to date/g)?.length, 3, r.out);
});

test('store-setup does not patch app info localizations while the app info is in review', () => {
  const r = run(fixture(), 'store-setup.mjs', ['--only=app'], { appInfo: { state: 'WAITING_FOR_REVIEW' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.writes.length, 0, JSON.stringify(r.writes));
  assert.match(r.out, /not editable now/);
});

test('app-setup does not patch an app info that is in review', () => {
  const r = run(fixture(), 'app-setup.mjs', ['--only=age,categories'], { appInfo: { state: 'WAITING_FOR_REVIEW' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.writes.length, 0, JSON.stringify(r.writes));
  assert.match(r.out, /WAITING_FOR_REVIEW: not editable/);
});

test('screenshots and header name the missing version instead of crashing', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'MyApp.xcodeproj', 'project.pbxproj'), 'MARKETING_VERSION = 1.1;\n');
  for (const script of ['screenshots.mjs', 'header.mjs']) {
    const r = run(dir, script, ['--dry'], { versionState: 'WAITING_FOR_REVIEW' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no App Store version 1\.1 .*1\.0 WAITING_FOR_REVIEW/, script);
    assert.doesNotMatch(r.out, /\n\s+at /, `${script} printed a stack trace`);
  }
});

test('doctor does not print the API key ID', () => {
  const r = run(fixture(), 'doctor.mjs', [], { availability: true, priced: true });
  assert.match(r.out, /API key TES…/, r.out);
  assert.doesNotMatch(r.out, /AuthKey_TEST/);
  const dir = fixture();
  rmSync(join(dir, 'AuthKey_TEST.p8'));
  const missing = run(dir, 'doctor.mjs');
  assert.match(missing.out, /API key file not found/, missing.out);
  assert.doesNotMatch(missing.out, /AuthKey_TEST/);
});

test('signing matches the local certificate when Apple drops the serial number leading zero',
  { skip: spawnSync('openssl', ['version']).status !== 0 && 'openssl missing' }, () => {
    const dir = fixture();
    const sign = join(dir, 'build', 'sign');
    mkdirSync(sign, { recursive: true });
    const gen = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(sign, 'dist.key'),
      '-subj', '/CN=Test Distribution', '-days', '2', '-set_serial', '0x0BDF8AF2C396434265947979C12793D8', '-outform', 'DER', '-out', join(sign, 'dist.cer')]);
    assert.equal(gen.status, 0, String(gen.stderr));
    const r = run(dir, 'signing.mjs', ['--dry', '--only=cert'], {
      certificates: [{ id: 'CERT1', type: 'certificates', attributes: { name: 'Apple Distribution: Test', serialNumber: 'BDF8AF2C396434265947979C12793D8', certificateType: 'DISTRIBUTION' } }],
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /using build\/sign\/dist\.cer \(Apple Distribution: Test/);
  });

test('submit refuses when a listed product is missing in App Store Connect', () => {
  const r = run(fixture(), 'submit.mjs', ['--submit'], { products: LISTED.slice(0, 2) });
  assert.equal(r.code, 1);
  assert.match(r.out, /pro\.lifetime is in the listing but not in App Store Connect/);
  assert.ok(!r.writes.some((w) => w.path.startsWith('/v1/reviewSubmissions')), 'touched a review submission');
});

test('submit stops on first products the API cannot add, and never sends the draft', () => {
  const r = run(fixture(), 'submit.mjs', ['--submit'], { products: LISTED, firstProductError: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Add for Review/);
  assert.ok(!r.writes.some((w) => w.method === 'PATCH' && w.body?.data?.attributes?.submitted), 'submitted anyway');
});

test('submit --products-added-on-web refuses products the draft does not show', () => {
  const r = run(fixture(), 'submit.mjs', ['--submit', '--products-added-on-web'], { products: LISTED, draft: true, inDraft: [0, 1] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /pro\.lifetime/);
  assert.ok(!r.writes.some((w) => w.body?.data?.attributes?.submitted), 'submitted anyway');
});

test('submit refuses a declared product in a state that cannot go to review', () => {
  const r = run(fixture(), 'submit.mjs', ['--submit'], { products: [...LISTED.slice(0, 2), { ...LISTED[2], state: 'REJECTED' }] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lifetime is REJECTED/);
  assert.ok(!r.writes.some((w) => w.path.startsWith('/v1/reviewSubmissions')));
});

test('an explicit --version that does not exist is an error, not another version', () => {
  const r = run(fixture(), 'submit.mjs', ['--version=1.0.1'], { products: LISTED });
  assert.equal(r.code, 1);
  assert.match(r.out, /no editable App Store version/);
  assert.equal(r.writes.length, 0);
});

test('a bare --release is an error', () => {
  const r = run(fixture(), 'submit.mjs', ['--submit', '--release'], { products: LISTED });
  assert.equal(r.code, 1);
  assert.match(r.out, /--release needs a value/);
  assert.equal(r.writes.length, 0);
});

test('asc.mjs CLI --dry prints the write and sends nothing', () => {
  const r = run(fixture(), 'lib/asc.mjs', ['POST', '/v1/bundleIds', '{}', '--dry', '--yes']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\(dry\) POST/);
  assert.equal(r.requests.length, 0);
});

test('submit --products-added-on-web submits the draft', () => {
  const r = run(fixture(), 'submit.mjs', ['--submit', '--products-added-on-web'], { products: LISTED, draft: true, inDraft: [0, 1, 2] });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.writes.some((w) => w.path === '/v1/reviewSubmissions/RS-DRAFT' && w.body.data.attributes.submitted === true));
});

test('submit refuses a release date that is not a whole hour, before any request', () => {
  const r = run(fixture(), 'submit.mjs', ['--release=2030-01-01T13:30:00Z'], { products: LISTED });
  assert.equal(r.code, 1);
  assert.match(r.out, /not a whole hour/);
  assert.equal(r.writes.length, 0);
});

test('asc.mjs CLI refuses writes without --yes', () => {
  const r = run(fixture(), 'lib/asc.mjs', ['POST', '/v1/bundleIds', '{}']);
  assert.equal(r.code, 2);
  assert.equal(r.requests.length, 0);
});

test('signing --dry needs --create-cert to make a certificate and writes nothing', () => {
  const dir = fixture();
  const r = run(dir, 'signing.mjs', ['--dry']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--create-cert once the owner agreed/);
  assert.equal(r.writes.length, 0);
  const r2 = run(dir, 'signing.mjs', ['--dry', '--create-cert']);
  assert.equal(r2.writes.length, 0, JSON.stringify(r2.writes));
  assert.match(r2.out, /\(dry\) POST \/v1\/bundleIds/);
  assert.match(r2.out, /\(dry\) POST \/v1\/profiles/);
});

/** The smallest PNG header pngSize() reads: signature + IHDR with width and height. */
function fakePng(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

test('screenshots --dry checks sizes and writes nothing', () => {
  const dir = fixture();
  const set = (folder, locale, name, w, h) => {
    mkdirSync(join(dir, 'Launch/store-screens', folder, locale), { recursive: true });
    writeFileSync(join(dir, 'Launch/store-screens', folder, locale, name), fakePng(w, h));
  };
  set('iphone69', 'en-US', '01-home.png', 1320, 2868);
  set('iphoneduo', 'en-US', '01-home.png', 2853, 2007);
  set('ipad13', 'en-US', '01-home.png', 1000, 1000); // wrong size
  mkdirSync(join(dir, 'Launch/store-screens/review'), { recursive: true });
  writeFileSync(join(dir, 'Launch/store-screens/review/paywall.png'), fakePng(1320, 2868));
  const r = run(dir, 'screenshots.mjs', ['--dry', '--locales=en-US'], { products: LISTED });
  assert.equal(r.writes.length, 0, JSON.stringify(r.writes));
  assert.match(r.out, /\(dry\) upload 01-home\.png/);
  assert.match(r.out, /APP_IPAD_PRO_3GEN_129: wrong size/);
  assert.equal(r.code, 1, 'a wrong size must fail the run');
});

test('init.sh copies templates once and adds the secrets to .gitignore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shipfast-init-'));
  const sh = (a) => spawnSync('bash', [join(SCRIPTS, 'init.sh'), a], { encoding: 'utf8' });
  assert.equal(sh(dir).status, 0);
  for (const f of ['ship.config.json', 'ship.local.json', 'listing.mjs', 'review-notes.txt']) assert.ok(existsSync(join(dir, 'ship', f)), f);
  writeFileSync(join(dir, 'ship', 'listing.mjs'), 'mine');
  sh(dir);
  assert.equal(readFileSync(join(dir, 'ship', 'listing.mjs'), 'utf8'), 'mine', 'overwrote an existing file');
  const gi = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n');
  for (const l of ['build/', 'ship/ship.local.json', '*.p8', '*.p12']) assert.equal(gi.filter((x) => x === l).length, 1, l);
});

test('store-screens.py composes frames at the App Store sizes', { skip: spawnSync('python3', ['-c', 'import PIL']).status !== 0 && 'Pillow missing' }, () => {
  const dir = fixture();
  const py = `
from PIL import Image
import os
for dev, size in {'iphone': (1206, 2622), 'ipad': (2064, 2752), 'duo-inner': (2853, 2007), 'duo-outer': (1398, 2034)}.items():
    for lang in ('en', 'fr'):
        d = os.path.join('build', 'raw', f'{dev}-{lang}'); os.makedirs(d, exist_ok=True)
        for shot in ('home', 'detail', 'paywall'):
            Image.new('RGB', size, (40, 80, 120)).save(os.path.join(d, shot + '.png'))
`;
  assert.equal(spawnSync('python3', ['-c', py], { cwd: dir }).status, 0);
  const r = spawnSync('python3', [join(SCRIPTS, 'store-screens.py')], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const check = spawnSync('python3', ['-c', `
from PIL import Image
for p, s in {'iphone69/en-US/01-home.png': (1320, 2868), 'ipad13/fr-FR/02-detail.png': (2064, 2752), 'iphoneduo/en-US/01-home.png': (2853, 2007), 'review/paywall.png': (1206, 2622)}.items():
    assert Image.open('Launch/store-screens/' + p).size == s, p
`], { cwd: dir, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});
