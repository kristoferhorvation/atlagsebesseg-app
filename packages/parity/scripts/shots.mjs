// A kör képei (AOS18): iOS-képek a VALÓDI térképpel, három méreten → docs/screenshots/<dátum>-aos18-ios-<méret>-<nézet>.png. A térképi réteget (GPS-jelölő, bounds-fit, „+N perc” címke, kamera)
// a paritás-kapu nem méri, ezért ezeket szemmel ellenőrizzük. Használat: `tsx packages/parity/scripts/shots.mjs [--device pro] [--view nav] [--out <mappa>]`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { BUNDLE, DEVICES, pick, ROOT } from './config.mjs';

const NAV = ['-sim', 'navsim', '-simPanel', 'NO'];
const VIEWS = {
  'ures': [...NAV],
  'kereses-hoterkep': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-mapZoom', '13', '-parityNoFollow', 'YES'],
  'kezi': [...NAV, '-manual', '0', '-heat', 'ki'],
  'valaszto': [...NAV, '-navStage', 'picker'],
  'nav': [...NAV, '-navStage', 'nav', '-simSeek', '0.075', '-simSpeed', '0.05'],
  'nav-meres': [...NAV, '-navStage', 'nav', '-simSeek', '0.64', '-simSpeed', '0.05', '-alt', 'aftergate'],
  'meres': ['-sim', 'lassit', '-simPanel', 'NO', '-simSeek', '0.5', '-simSpeed', '0.05'],
  'bejelentes': [...NAV, '-heat', 'ki', '-reportOpen', 'YES'],
  'beallitasok-zona': [...NAV, '-heat', 'ki', '-settingsOpen', 'zone', '-simPlaces', 'YES'],
  // AW22
  'fiok-ki': [...NAV, '-heat', 'ki', '-settingsOpen', 'top', '-accountEmailOpen', 'YES'],
  'fiok-nincs-beallitva': [...NAV, '-heat', 'ki', '-settingsOpen', 'top', '-accountSim', 'off'],
  'fiok-be': [...NAV, '-heat', 'ki', '-settingsOpen', 'top', '-accountSim', 'in'],
  'fiok-nev': [...NAV, '-heat', 'ki', '-nameStep', 'Anna'],
  'fiok-ajanlat': [...NAV, '-heat', 'ki', '-nudge', 'YES'],
  'veszely': [...NAV, '-heat', 'ki', '-reportOpen', 'YES', '-reportHazard', 'YES'],
  'vissza-mini': [...NAV, '-navStage', 'nav', '-simAt', '60', '-simSpeed', '0.05', '-manual', '0', '-manualMini', 'YES', '-parityNoFollow', 'YES'],
  // AW23
  'gombsor-nav': [...NAV, '-navStage', 'nav', '-simAt', '60', '-simSpeed', '0.05'],
  'gombsor-nav-vissza': [...NAV, '-navStage', 'nav', '-simAt', '60', '-simSpeed', '0.05', '-parityNoFollow', 'YES'],
  'gombsor-nav-mini': [...NAV, '-navStage', 'nav', '-simAt', '60', '-simSpeed', '0.05', '-manual', '0', '-manualMini', 'YES'],
  'gombsor-ures-vissza': [...NAV, '-heat', 'ki', '-parityNoFollow', 'YES'],
  'gombsor-ures-mini-vissza': [...NAV, '-heat', 'ki', '-manual', '0', '-manualMini', 'YES', '-miniAlways', 'YES', '-parityNoFollow', 'YES'],
  'panel': [...NAV, '-navStage', 'nav', '-simAt', '60', '-simSpeed', '0.05', '-navPanel', 'YES'],
  'kereses': [...NAV, '-heat', 'ki', '-navStage', 'search', '-navQuery', 'Mam'],
  'krusing': ['-cruise', 'YES', '-simPanel', 'NO', '-simAt', '300', '-simSpeed', '0.05', '-heat', 'ki'],
  'dugo-kerdes': [...NAV, '-navStage', 'nav', '-simAt', '60', '-simSpeed', '0.05', '-jamAskPreview', 'YES'],
  // AW24
  'heat-gyakorisag-kozel': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'gyakorisag', '-mapLat', '47.5015', '-mapLon', '19.0645', '-mapZoom', '14.6', '-parityNoFollow', 'YES'],
  'heat-gyakorisag-kozep': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'gyakorisag', '-mapLat', '47.4985', '-mapLon', '19.07', '-mapZoom', '12.4', '-parityNoFollow', 'YES'],
  'heat-gyakorisag-tavol': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'gyakorisag', '-mapLat', '47.53', '-mapLon', '18.85', '-mapZoom', '9.3', '-parityNoFollow', 'YES'],
  'heat-atlagsebesseg-kozel': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'atlagsebesseg', '-mapLat', '47.5015', '-mapLon', '19.0645', '-mapZoom', '14.6', '-parityNoFollow', 'YES'],
  'heat-atlagsebesseg-tavol': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'atlagsebesseg', '-mapLat', '47.53', '-mapLon', '18.85', '-mapZoom', '9.3', '-parityNoFollow', 'YES'],
  'cruise-full': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-cruiseDemo', 'full'],
  'cruise-ready': [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-cruiseDemo', 'ready'],
  'cruise-strip': [...NAV, '-heat', 'ki', '-cruiseDemo', 'strip'],
  'account-in-top': [...NAV, '-heat', 'ki', '-settingsOpen', 'top', '-accountSim', 'in'],
  'account-in-privacy': [...NAV, '-heat', 'ki', '-settingsOpen', 'privacy', '-accountSim', 'in'],
  'account-in-bottom': [...NAV, '-heat', 'ki', '-settingsOpen', 'signout', '-accountSim', 'in'],
  'account-out-top': [...NAV, '-heat', 'ki', '-settingsOpen', 'top'],
  'live-figyel': [...NAV, '-livePreview', 'YES', '-liveGallery', 'figyel'],
};
const argv = process.argv.slice(2);
const devices = pick(argv, 'device')?.split(',') ?? Object.keys(DEVICES);
const views = pick(argv, 'view')?.split(',') ?? Object.keys(VIEWS);
const out = pick(argv, 'out') ?? join(ROOT, 'docs', 'screenshots');
const date = pick(argv, 'date') ?? '2026-11-03';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });
/** A kép világos részaránya: a csupa fekete (indul az app, nem rajzolt a térkép) nem kész. */
function ready(file) {
  const img = PNG.sync.read(readFileSync(file));
  let lit = 0;
  let n = 0;
  for (let k = img.width * Math.floor(img.height * 0.1) * 4; k < img.data.length; k += 4 * 53) {
    n++;
    if (img.data[k] + img.data[k + 1] + img.data[k + 2] > 90) lit++;
  }
  return lit / n > 0.04;
}

const simctl = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
for (const device of devices) {
  const { udid } = DEVICES[device];
  // egyszerre egy szimulátor: három mellett a memória elfogy, és a térkép feketén marad
  for (const other of Object.values(DEVICES)) {
    if (other.udid !== udid) {
      try {
        simctl('shutdown', other.udid);
      } catch {
        // nem futott
      }
    }
  }
  try {
    simctl('boot', udid);
  } catch {
    // már fut
  }
  simctl('bootstatus', udid, '-b');
  await sleep(30_000);
  // AW24: az első indítás után a térkép még üres (csempe-gyorsítótár, első indításkor kihagyott argumentumok) – egy bemelegítő indítás, kép nélkül
  execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, BUNDLE, '-lang:v1', 'hu', ...VIEWS[views[0]]], { stdio: 'ignore' });
  await sleep(45_000);
  for (const view of views) {
    execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, BUNDLE, '-lang:v1', 'hu', ...VIEWS[view]], { stdio: 'ignore' });
    // friss szimulátoron az app + a Mapbox-csempék 30–60 s
    await sleep(45_000);
    const file = join(out, `${date}-${pick(argv, 'round') ?? 'aos18'}-ios-${device}-${view}.png`);
    for (let i = 0; i < 12; i++) {
      execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', file], { stdio: 'ignore' });
      if (ready(file)) break;
      await sleep(10_000);
    }
    if (!ready(file)) console.log(`FEKETE: ${file}`);
    execFileSync('sips', ['-Z', '1100', file], { stdio: 'ignore' });
    console.log(`kép: ${file}`);
  }
  simctl('shutdown', udid);
}
