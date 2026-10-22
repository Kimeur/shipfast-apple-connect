// Bundle IDs, the Apple Distribution certificate and App Store provisioning profiles, through the API.
// Everything secret lands in <root>/build/sign/ (gitignored): the private key, the certificate, the .p12,
// a throwaway keychain and its password, and the profiles. Never commit that folder.
//
// Usage: node signing.mjs [--dry] [--create-cert] [--only=bundles,cert,profiles,keychain]
//   --create-cert  create a new Apple Distribution certificate when build/sign/ has none. An account can hold
//                  only a few distribution certificates, so this needs the owner's go-ahead.
//
// Config: app.bundleId, app.name, targets[] ({ bundleId, name?, profileName }), team.teamId.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DRY, all, failureLog, flag, get, info, list, need, rel, rootPath, step, warn, write } from './lib/util.mjs';

const ONLY = list('only') ? new Set(list('only')) : null;
const want = (s) => !ONLY || ONLY.has(s);
const { attempt, finish } = failureLog();
const SIGN = rootPath(get('signing.dir', 'build/sign'));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const targets = get('targets', [{ bundleId: need('app.bundleId'), profileName: `${need('app.name')} App Store` }]);
console.log(`${need('app.name')} · ${targets.length} target(s) · secrets in ${SIGN}${DRY ? '  (dry run)' : ''}`);
if (!DRY) { mkdirSync(SIGN, { recursive: true }); chmodSync(SIGN, 0o700); }

// ─── Bundle IDs ──────────────────────────────────────────────────────────────────────────────────
const bundles = {};
if (want('bundles') || want('profiles')) {
  step('bundle IDs');
  for (const t of targets) {
    await attempt(`bundle ID ${t.bundleId}`, async () => {
      const found = (await all(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(t.bundleId)}&filter[platform]=IOS&limit=50`)).data
        .find((b) => b.attributes.identifier === t.bundleId); // the filter also matches longer identifiers
      if (found) { bundles[t.bundleId] = found.id; return info(`${t.bundleId}: exists (${found.id})`); }
      if (!want('bundles')) throw new Error(`${t.bundleId} does not exist: run with --only=bundles first`);
      const r = await write('POST', '/v1/bundleIds', {
        data: { type: 'bundleIds', attributes: { identifier: t.bundleId, name: t.name ?? t.profileName.replace(/ App Store$/, ''), platform: 'IOS' } },
      });
      bundles[t.bundleId] = r.data.id;
      info(`${t.bundleId}: created (${r.data.id})`);
      // Capabilities that need no settings (e.g. PUSH_NOTIFICATIONS) can be listed under target.capabilities.
      // App Groups and iCloud containers need identifiers made in the web UI first (unverified through the API).
      for (const cap of t.capabilities ?? []) {
        await write('POST', '/v1/bundleIdCapabilities', {
          data: { type: 'bundleIdCapabilities', attributes: { capabilityType: cap }, relationships: { bundleId: rel('bundleIds', r.data.id) } },
        });
        info(`   capability ${cap} enabled`);
      }
    });
  }
}

// ─── Apple Distribution certificate ─────────────────────────────────────────────────────────────
const CER = join(SIGN, 'dist.cer');
const KEY = join(SIGN, 'dist.key');
const P12 = join(SIGN, 'dist.p12');
let certId = null;
if (want('cert') || want('profiles')) {
  step('Apple Distribution certificate');
  await attempt('certificate', async () => {
    const certs = (await all('/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50')).data;
    if (existsSync(CER)) {
      // Match the local certificate to Apple's list by serial number. openssl pads it to whole bytes
      // ("0BDF…"), Apple drops leading zeros ("BDF…"): compare without them.
      const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/^0+/, '');
      const serial = norm(run('openssl', ['x509', '-inform', 'DER', '-in', CER, '-noout', '-serial']).split('=')[1]);
      const mine = certs.find((c) => norm(c.attributes.serialNumber) === serial);
      if (!mine) throw new Error(`build/sign/dist.cer (serial ${serial}) is not an active distribution certificate on this team`);
      certId = mine.id;
      return info(`using build/sign/dist.cer (${mine.attributes.name ?? mine.id}, expires ${mine.attributes.expirationDate?.slice(0, 10)})`);
    }
    info(`${certs.length} distribution certificate(s) on the team, none in build/sign/`);
    if (flag('create-cert') !== true) {
      throw new Error('no local certificate. Either copy an existing one (dist.cer + dist.key) into build/sign/, or re-run with --create-cert once the owner agreed (see references/signing.md).');
    }
    if (DRY) return info('(dry) would create a key, a CSR and a DISTRIBUTION certificate');
    run('openssl', ['genrsa', '-out', KEY, '2048']);
    chmodSync(KEY, 0o600);
    const csr = run('openssl', ['req', '-new', '-key', KEY, '-subj', `/CN=${need('app.name')} Distribution/O=${get('team.name', 'Team')}`]);
    const r = await write('POST', '/v1/certificates', { data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } } });
    writeFileSync(CER, Buffer.from(r.data.attributes.certificateContent, 'base64'));
    certId = r.data.id;
    info(`created ${r.data.id}, expires ${r.data.attributes.expirationDate?.slice(0, 10)}`);
  });
}

// ─── .p12 and a keychain used only for builds ───────────────────────────────────────────────────
const KC = join(SIGN, 'signing.keychain-db');
const PASS = join(SIGN, 'keychain.pass');
if (want('keychain') && !DRY) {
  step('signing keychain');
  await attempt('keychain', async () => {
    if (!existsSync(CER) || !existsSync(KEY)) throw new Error('need build/sign/dist.cer and dist.key first');
    if (!existsSync(PASS)) { writeFileSync(PASS, randomBytes(24).toString('hex')); chmodSync(PASS, 0o600); }
    const pass = readFileSync(PASS, 'utf8').trim();
    if (!existsSync(P12)) {
      const pem = join(SIGN, 'dist.pem');
      run('openssl', ['x509', '-inform', 'DER', '-in', CER, '-out', pem]);
      // -legacy keeps the .p12 readable by macOS's security tool (OpenSSL 3 defaults to newer ciphers).
      const legacy = run('openssl', ['version']).startsWith('OpenSSL 3') ? ['-legacy'] : [];
      run('openssl', ['pkcs12', '-export', ...legacy, '-inkey', KEY, '-in', pem, '-out', P12, '-passout', `pass:${pass}`]);
      chmodSync(P12, 0o600);
    }
    if (!existsSync(KC)) {
      run('security', ['create-keychain', '-p', pass, KC]);
      run('security', ['set-keychain-settings', '-lut', '21600', KC]);
      run('security', ['unlock-keychain', '-p', pass, KC]);
      run('security', ['import', P12, '-k', KC, '-P', pass, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
      run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', pass, KC]);
      info('keychain created; build-upload.sh adds it to the search list only while it builds');
    } else info('keychain exists');
  });
}

// ─── App Store profiles ──────────────────────────────────────────────────────────────────────────
if (want('profiles')) {
  step('App Store provisioning profiles');
  for (const t of targets) {
    await attempt(`profile ${t.profileName}`, async () => {
      const file = join(SIGN, `${t.bundleId}.mobileprovision`);
      const found = (await all(`/v1/profiles?filter[name]=${encodeURIComponent(t.profileName)}&filter[profileType]=IOS_APP_STORE&include=certificates&limit=50`));
      const active = found.data.find((p) => p.attributes.name === t.profileName && p.attributes.profileState === 'ACTIVE'
        && (!certId || (p.relationships?.certificates?.data ?? []).some((c) => c.id === certId)));
      let profile = active;
      if (profile) info(`${t.profileName}: exists (${profile.attributes.uuid})`);
      else {
        if (!certId && !DRY) throw new Error('no certificate id: run the cert step first');
        if (!bundles[t.bundleId] && !DRY) throw new Error(`no bundle ID resource for ${t.bundleId}`);
        profile = (await write('POST', '/v1/profiles', {
          data: {
            type: 'profiles',
            attributes: { name: t.profileName, profileType: 'IOS_APP_STORE' },
            relationships: {
              bundleId: rel('bundleIds', bundles[t.bundleId] ?? 'DRY'),
              certificates: { data: [{ type: 'certificates', id: certId ?? 'DRY' }] },
            },
          },
        })).data;
        info(`${t.profileName}: created${profile.attributes.uuid ? ` (${profile.attributes.uuid})` : ''}`);
      }
      if (!DRY && profile.attributes.profileContent) {
        writeFileSync(file, Buffer.from(profile.attributes.profileContent, 'base64'));
        info(`   saved ${file.replace(rootPath('.') + '/', '')}`);
      }
    });
  }
}

finish('Signing ready. Next: build-upload.sh');
