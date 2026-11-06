// AW25b: App Store Connect API (fastlane nélkül) – a NEM szöveges metaadat és a képernyőképek feltöltése, BEADÁS NÉLKÜL.
// A kulcs: ASC_KEY_ID + ASC_ISSUER_ID a Secrets.xcconfig-ban, a .p8 az apps/ios/secrets/ alatt (mint a testflight.sh-nál); értéket nem ír ki.
// Használat (az apps/ios mappából):
//   node scripts/asc.mjs status              – csak olvas: app, verzió, kategória, kor-besorolás, ár, elérhetőség, lokalizációk, képek
//   node scripts/asc.mjs meta                – kategória, kor-besorolás, ár (ingyenes), elérhetőség, support / privacy URL, review-jegyzet
//   node scripts/asc.mjs shots <mappa>       – <mappa>/<locale>/*.png → APP_IPHONE_67 képsor (a meglévő sor képeit cseréli)
// A szöveges adatlap (név, alcím, leírás, kulcsszavak, promóciós szöveg, újdonságok) szándékosan NINCS benne (docs/store/listing.md, jóváhagyásra).
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const IOS = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(IOS, '..', '..');
const BUNDLE_ID = 'hu.atlagsebesseg.app';
const xc = readFileSync(join(IOS, 'Secrets.xcconfig'), 'utf8');
const conf = (k) => process.env[k] ?? xc.match(new RegExp(`^${k} *= *(.+)$`, 'm'))?.[1]?.trim();
const KEY_ID = conf('ASC_KEY_ID');
const ISSUER = conf('ASC_ISSUER_ID');
if (!KEY_ID || !ISSUER) throw new Error('ASC_KEY_ID / ASC_ISSUER_ID hiányzik');
const keyPath = process.env.ASC_KEY_PATH ?? join(IOS, 'secrets', `AuthKey_${KEY_ID}.p8`);
const KEY = createPrivateKey(readFileSync(keyPath));

const b64 = (b) => Buffer.from(b).toString('base64url');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: KEY, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64(sig)}`;
}

export async function api(method, path, body) {
  const url = path.startsWith('http') ? path : `https://api.appstoreconnect.apple.com${path}`;
  for (let i = 0; ; i++) {
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 && i < 3) {
      await new Promise((ok) => setTimeout(ok, 5000 * (i + 1)));
      continue;
    }
    const text = await r.text();
    const json = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const err = new Error(`${method} ${path} → HTTP ${r.status}: ${(json?.errors ?? []).map((e) => `${e.code} ${e.detail ?? e.title}`).join(' | ')}`);
      err.status = r.status;
      throw err;
    }
    return json;
  }
}
const get = (p) => api('GET', p);

/** Az EU 27 + UK + CH + RS (a RO és a HR az EU része). */
export const TERRITORIES = ['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE', 'GBR', 'CHE', 'SRB'];
/** Az app nyelvei → ASC-lokalizáció. */
export const LOCALES = { hu: 'hu', en: 'en-US', de: 'de-DE', sk: 'sk', cs: 'cs', pl: 'pl' };
const SUPPORT_URL = 'https://tempomate.app/support';
const PRIVACY_URL = 'https://tempomate.app/privacy';

async function context() {
  const apps = await get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) throw new Error(`nincs app: ${BUNDLE_ID}`);
  const versions = await get(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`);
  const editable = versions.data.find((v) => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(v.attributes.appStoreState ?? v.attributes.appVersionState));
  const infos = await get(`/v1/apps/${app.id}/appInfos`);
  const info = infos.data.find((i) => !['READY_FOR_SALE', 'REPLACED_WITH_NEW_INFO'].includes(i.attributes.appStoreState ?? i.attributes.state)) ?? infos.data[0];
  return { app, versions: versions.data, version: editable ?? null, info };
}

async function status() {
  const { app, versions, version, info } = await context();
  console.log(`app: ${app.attributes.name} (${app.attributes.bundleId}), elsődleges nyelv: ${app.attributes.primaryLocale}`);
  console.log(`verziók: ${versions.map((v) => `${v.attributes.versionString} ${v.attributes.appStoreState ?? v.attributes.appVersionState}`).join(', ') || '–'}`);
  const cat = await get(`/v1/appInfos/${info.id}?include=primaryCategory,secondaryCategory`);
  console.log(`kategória: ${cat.data.relationships.primaryCategory.data?.id ?? '–'} / ${cat.data.relationships.secondaryCategory.data?.id ?? '–'}`);
  const age = await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`).catch((e) => ({ error: e.message }));
  console.log(`kor-besorolás: ${age.error ?? JSON.stringify(age.data?.attributes)}`);
  const ail = await get(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  console.log(`appInfo-lokalizációk: ${ail.data.map((l) => `${l.attributes.locale}${l.attributes.privacyPolicyUrl ? ' (privacy ✓)' : ''}`).join(', ')}`);
  const price = await get(`/v1/apps/${app.id}/appPriceSchedule`).catch((e) => ({ error: e.message }));
  console.log(`ár-ütemezés: ${price.error ? price.error : 'van'}`);
  const avail = await get(`/v1/apps/${app.id}/appAvailabilityV2`).catch((e) => ({ error: e.message }));
  console.log(`elérhetőség: ${avail.error ? avail.error : 'van'}`);
  if (!version) return console.log('szerkeszthető App Store-verzió: nincs');
  console.log(`szerkeszthető verzió: ${version.attributes.versionString} (${version.id})`);
  const loc = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  for (const l of loc.data) {
    const sets = await get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?include=appScreenshots`);
    const shots = sets.data.map((s) => `${s.attributes.screenshotDisplayType}: ${s.relationships.appScreenshots.data.length}`).join(', ');
    console.log(`  ${l.attributes.locale}: support ${l.attributes.supportUrl ? '✓' : '–'}, képek: ${shots || '–'}`);
  }
  const rd = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
  console.log(`review-jegyzet: ${rd?.data ? `${(rd.data.attributes.notes ?? '').length} karakter, demo-fiók: ${rd.data.attributes.demoAccountRequired}` : '–'}`);
}

const cmd = process.argv[2];
if (cmd === 'status') await status();
else if (cmd === 'meta') await (await import('./asc-meta.mjs')).run({ api, get, context, TERRITORIES, LOCALES, SUPPORT_URL, PRIVACY_URL, ROOT });
else if (cmd === 'shots') await (await import('./asc-shots.mjs')).run({ api, get, context, LOCALES, dir: process.argv[3], readdirSync, readFileSync, statSync, createHash, join });
else console.log('használat: node scripts/asc.mjs status | meta | shots <mappa>');
