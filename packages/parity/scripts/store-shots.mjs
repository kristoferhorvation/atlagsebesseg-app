// AW25b: App Store-képernyőképek – iPhone 17 Pro Max (1320 × 2868, a 6,9"-os kötelező méret; a kisebbeket az ASC ebből skálázza),
// egy szimulátor, a jóváhagyott szimulátor-fixtúrákból, 6 nyelven, keret nélkül, állapotsor 9:41.
// Kimenet: docs/store/screenshots/<ASC-locale>/<nn>-<jelenet>.png. Feltöltés: `node apps/ios/scripts/asc.mjs shots docs/store/screenshots`.
// Használat: tsx packages/parity/scripts/store-shots.mjs [--lang hu,en] [--only 01,03]  (előtte a Debug app telepítve a Pro Max szimulátoron)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { BUNDLE, DEVICES, pick, ROOT } from './config.mjs';

const OUT = join(ROOT, 'docs', 'store', 'screenshots');
const TMP = mkdtempSync(join(tmpdir(), 'store-'));
const { udid } = DEVICES.max;
const LOCALES = { hu: 'hu', en: 'en-US', de: 'de-DE', sk: 'sk', cs: 'cs', pl: 'pl' };
const argv = process.argv.slice(2);
const langs = pick(argv, 'lang')?.split(',') ?? Object.keys(LOCALES);
const only = pick(argv, 'only')?.split(',');
const NAV = ['-sim', 'navsim', '-simPanel', 'NO'];
/** [sorszám, név, indító-argumentumok] – a sorrend az áruházi sorrend. */
const SCENES = [
  ['01', 'measure', ['-sim', 'jo', '-simPanel', 'NO', '-simSeek', '0.5', '-simSpeed', '0.05', '-heat', 'ki']],
  ['02', 'navigation', [...NAV, '-navStage', 'nav', '-simSeek', '0.3', '-simSpeed', '0.05', '-alt', 'off', '-heat', 'ki']],
  ['03', 'route-picker', [...NAV, '-navStage', 'picker', '-heat', 'ki']],
  // a Live Activity mock-előnézete fejlesztői feliratokat mutat („(mock)”) – áruházi képnek nem való, kimarad
  ['04', 'heatmap', [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'gyakorisag', '-mapLat', '47.4985', '-mapLon', '19.062', '-mapZoom', '13.2', '-parityNoFollow', 'YES', '-cruiseDemo', 'ready']],
  ['05', 'report', ['-sim', 'jo', '-simPanel', 'NO', '-simSeek', '0.3', '-simSpeed', '0.05', '-reportOpen', 'YES', '-heat', 'ki']],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simctl = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 });
for (const d of Object.values(DEVICES)) {
  if (d.udid === udid) continue;
  try {
    simctl('shutdown', d.udid);
  } catch {
    // nem futott
  }
}
try {
  simctl('boot', udid);
} catch {
  // már fut
}
simctl('bootstatus', udid, '-b');
await sleep(20_000);
simctl('status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--wifiBars', '3', '--cellularBars', '4');
let bad = 0;
for (const lang of langs) {
  mkdirSync(join(OUT, LOCALES[lang]), { recursive: true });
  for (const [id, name, args] of SCENES) {
    if (only && !only.includes(id)) continue;
    // friss indítás után az első futás az argumentumokat elhagyhatja: kétszer indítva (AW24)
    for (let i = 0; i < 2; i++) {
      execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, BUNDLE, '-lang:v1', lang, ...args], { stdio: 'ignore', timeout: 120_000 });
      await sleep(i === 0 ? 8000 : 60_000);
    }
    const file = join(OUT, LOCALES[lang], `${id}-${name}.png`);
    for (let i = 0; ; i++) {
      try {
        const tmp = join(TMP, `${lang}-${id}.png`);
        execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', tmp], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 });
        copyFileSync(tmp, file);
        break;
      } catch (e) {
        console.log(`simctl io hiba (${i + 1}. próba): ${String(e.stderr ?? '').trim()}`);
        if (i === 2) throw e;
        await sleep(10_000);
      }
    }
    // az ASC az alfa-csatornás képet elutasítja: RGB-be írva
    const img = PNG.sync.read(readFileSync(file));
    writeFileSync(file, PNG.sync.write(img, { colorType: 2 }));
    const { width, height } = img;
    const ok = width === 1320 && height === 2868;
    if (!ok) bad++;
    console.log(`${ok ? 'kép' : 'ROSSZ MÉRET'}: ${LOCALES[lang]}/${id}-${name}.png (${width} × ${height})`);
  }
}
simctl('status_bar', udid, 'clear');
try {
  simctl('terminate', udid, BUNDLE);
} catch {
  // nem futott
}
simctl('shutdown', udid);
process.exit(bad ? 1 : 0);
