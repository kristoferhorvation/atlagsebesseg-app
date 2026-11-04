// A kör képei (AOS18): iOS-képek a VALÓDI térképpel, három méreten → docs/screenshots/<dátum>-aos18-ios-<méret>-<nézet>.png. A térképi réteget (GPS-jelölő, bounds-fit, „+N perc” címke, kamera)
// a paritás-kapu nem méri, ezért ezeket szemmel ellenőrizzük. Használat: `tsx packages/parity/scripts/shots.mjs [--device pro] [--view nav] [--out <mappa>]`.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
  'live-figyel': [...NAV, '-livePreview', 'YES', '-liveGallery', 'figyel'],
};
const argv = process.argv.slice(2);
const devices = pick(argv, 'device')?.split(',') ?? Object.keys(DEVICES);
const views = pick(argv, 'view')?.split(',') ?? Object.keys(VIEWS);
const out = pick(argv, 'out') ?? join(ROOT, 'docs', 'screenshots');
const date = pick(argv, 'date') ?? '2026-11-03';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });
for (const device of devices) {
  const { udid } = DEVICES[device];
  for (const view of views) {
    execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, BUNDLE, '-lang:v1', 'hu', ...VIEWS[view]], { stdio: 'ignore' });
    // friss szimulátoron az app + a Mapbox-csempék 30–60 s
    await sleep(45_000);
    const file = join(out, `${date}-aos18-ios-${device}-${view}.png`);
    execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', file], { stdio: 'ignore' });
    execFileSync('sips', ['-Z', '1100', file], { stdio: 'ignore' });
    console.log(`kép: ${file}`);
  }
}
