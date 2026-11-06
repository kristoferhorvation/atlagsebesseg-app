// AW24: a Lovable-assetek pótlása (docs/marketing/assets-index.md): iPhone 17 Pro, egy szimulátor, állapotsor 9:41, kicsinyítés nélkül. A hőtérkép-kép a kör saját csíkos nézete.
// Használat: tsx packages/parity/scripts/landing-assets.mjs [--only 01,04,09,13,15]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { BUNDLE, DEVICES, pick, ROOT } from './config.mjs';

const OUT = join(ROOT, 'docs', 'marketing', 'lovable-assets');
const TMP = mkdtempSync(join(tmpdir(), 'landing-'));
const { udid } = DEVICES.pro;
const NAV = ['-sim', 'navsim', '-simPanel', 'NO'];
const only = pick(process.argv.slice(2), 'only')?.split(',');
const JOBS = [
  ['01', '01-hero-measure-green-en', 'en', ['-sim', 'jo', '-simPanel', 'NO', '-simSeek', '0.5', '-simSpeed', '0.05', '-heat', 'ki']],
  ['09', '09-camera-near-en', 'en', [...NAV, '-navStage', 'nav', '-simSeek', pick(process.argv.slice(2), 'cameraSeek') ?? '0.775', '-simSpeed', '0.05', '-alt', 'off', '-heat', 'ki']],
  // a HU-párral azonos jelenet: az élő navigációs állapot (a minta-galéria magyar szövegű), a lezárt képernyős kártyára vágva
  ['13', '13-live-activity-nav-en', 'en', [...NAV, '-navStage', 'nav', '-livePreview', 'YES'], 'card'],
  ['04', '04-start-screen-en', 'en', []],
  ['04', '04-start-screen-hu', 'hu', []],
  ['15', '15-heatmap-hu', 'hu', [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'gyakorisag', '-mapLat', '47.4985', '-mapLon', '19.062', '-mapZoom', '13.2', '-parityNoFollow', 'YES', '-cruiseDemo', 'ready']],
  ['15', '15-heatmap-en', 'en', [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'gyakorisag', '-mapLat', '47.4985', '-mapLon', '19.062', '-mapZoom', '13.2', '-parityNoFollow', 'YES', '-cruiseDemo', 'ready']],
];
/** A lezárt képernyős widget kivágása (a HU-párral egyezően: teljes szélesség, a kártya ± 20 px): a kártya a legelső sötét (#0A0B0E-szerű) sáv a kép közepén. */
function cropCard(file) {
  const img = PNG.sync.read(readFileSync(file));
  // a sor a kártyáé, ha a pixelei több mint fele sötét (a szöveg csak kis részt takar)
  const dark = (y) => {
    let d = 0;
    for (let x = 0; x < img.width; x++) {
      const k = (y * img.width + x) * 4;
      if (img.data[k] + img.data[k + 1] + img.data[k + 2] <= 45) d++;
    }
    return d / img.width > 0.5;
  };
  let y0 = Math.floor(img.height * 0.25);
  while (y0 < img.height && !dark(y0)) y0++;
  let y1 = y0;
  while (y1 < img.height && dark(y1)) y1++;
  const top = Math.max(0, y0 - 20);
  const h = Math.min(img.height, y1 + 20) - top;
  const out = new PNG({ width: img.width, height: h });
  PNG.bitblt(img, out, 0, top, img.width, h, 0, 0);
  writeFileSync(file, PNG.sync.write(out));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simctl = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
for (const d of Object.values(DEVICES)) {
  try {
    simctl('shutdown', d.udid);
  } catch {
    // nem futott
  }
}
await sleep(5000);
simctl('boot', udid);
simctl('bootstatus', udid, '-b');
await sleep(30_000);
simctl('status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--wifiBars', '3', '--cellularBars', '4');
for (const [id, name, lang, args, crop] of JOBS) {
  if (only && !only.includes(id)) continue;
  // friss telepítés után az első indítás az argumentumokat elhagyhatja: a kezdőképernyőt a tárolt állapot nélkül, a többit kétszer indítva
  if (id === '04') {
    try {
      simctl('terminate', udid, BUNDLE);
    } catch {
      // nem futott
    }
  }
  for (let i = 0; i < 2; i++) {
    execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, BUNDLE, '-lang:v1', lang, ...args], { stdio: 'ignore' });
    await sleep(i === 0 ? 8000 : 75_000);
  }
  // a `simctl io` ritkán átmenetileg hibázik (AW24): újrapróba. A kép ideiglenes fájlba megy, a helyére a node másolja: a macOS a CoreSimulatornak
  // nem engedi felülírni a nem általa létrehozott fájlt („Operation not permitted”, AW24: a 04-es kép)
  for (let i = 0; ; i++) {
    try {
      const tmp = join(TMP, `${name}.png`);
      execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
      copyFileSync(tmp, join(OUT, `${name}.png`));
      break;
    } catch (e) {
      console.log(`simctl io hiba (${i + 1}. próba): ${String(e.stderr ?? '').trim()}`);
      if (i === 5) throw e;
      await sleep(10_000);
    }
  }
  if (crop === 'card') cropCard(join(OUT, `${name}.png`));
  console.log(`kép: ${name}`);
}
simctl('status_bar', udid, 'clear');
simctl('shutdown', udid);
