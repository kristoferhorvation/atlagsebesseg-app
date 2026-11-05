// AW24: a kör képei a dev-szerverről: hőtérkép csíkokkal (gyakoriság / átlagsebesség, közelről / kizoomolva), krúzing-kártya, Fiók-kártya. docs/screenshots/<dátum>-aw24-web-*.png
// Használat: node scripts/aw24-shots.mjs [heat|cruise|account] [szélesség]. A szélesség nélkül mind a négy méret.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeChrome, launchChrome, openPage, sleep } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const DATE = new Date().toISOString().slice(0, 10);
const ALL = [[320, 667], [375, 667], [402, 874], [440, 956]];
const only = process.argv[2];
const SIZES = process.argv[3] ? ALL.filter(([w]) => String(w) === process.argv[3]) : ALL;
const MAP_READY = `!!document.querySelector('.mapboxgl-canvas')`;
const q = (s) => `document.querySelector(${JSON.stringify(s)})`;

const chrome = await launchChrome({ photo: true });
const page = async (w, h, path, map = 'photo') => {
  const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map });
  await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await p.goto(path);
  return p;
};
try {
  for (const [w, h] of SIZES) {
    if (!only || only === 'heat') {
      const p = await page(w, h, '/?navsim&heatSeed&heat=sajat&heatView=gyakorisag&panel=0');
      await p.waitFor(MAP_READY, 60000, 'térkép');
      await p.waitFor(`(document.querySelector('.mapboxgl-map')?.dataset.heat ?? '') !== ''`, 60000, 'réteg');
      for (const [zname, lat, lon, zoom] of [['kozel', 47.5015, 19.0645, 14.6], ['kozep', 47.4985, 19.07, 12.4], ['tavol', 47.53, 18.85, 9.3]]) {
        await p.evaluate(`window.__mapJump(${lat}, ${lon}, ${zoom})`);
        await sleep(5000);
        await p.shot(`${DATE}-aw24-web-heat-gyakorisag-${zname}-${w}.png`);
      }
      await p.evaluate(`document.querySelector('.heat-switch .segmented button[aria-pressed="false"]').click()`);
      for (const [zname, lat, lon, zoom] of [['kozel', 47.5015, 19.0645, 14.6], ['tavol', 47.53, 18.85, 9.3]]) {
        await p.evaluate(`window.__mapJump(${lat}, ${lon}, ${zoom})`);
        await sleep(5000);
        await p.shot(`${DATE}-aw24-web-heat-atlagsebesseg-${zname}-${w}.png`);
      }
      await p.close();
    }
    if (!only || only === 'cruise') {
      for (const kind of ['full', 'ready', 'strip']) {
        const p = await page(w, h, `/?navsim&panel=0&heat=sajat&heatSeed&cruiseDemo=${kind}`);
        await p.waitFor(q('.cruise-card'), 60000, 'kártya');
        await sleep(4000);
        await p.shot(`${DATE}-aw24-web-cruise-${kind}-${w}.png`);
        await p.close();
      }
      for (const look of ['vilagos', 'visszafogott']) {
        const p = await page(w, h, `/?navsim&panel=0&heat=ki&cruiseDemo=full`);
        await p.evaluate(`localStorage.setItem('settings:v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('settings:v1') ?? '{}'), terkep: '${look}' })); location.reload(); true`);
        await sleep(1500);
        await p.waitFor(q('.cruise-card'), 60000, 'kártya');
        await sleep(4000);
        await p.shot(`${DATE}-aw24-web-cruise-full-${look}-${w}.png`);
        await p.close();
      }
    }
    if (!only || only === 'account') {
      for (const state of ['in', 'out']) {
        const p = await page(w, h, `/?navsim&panel=0&heat=ki&sheet=settings&account=${state}`, 'blank');
        await p.waitFor(q('[data-testid="account-card"]'), 60000, 'fiók');
        await p.evaluate(`localStorage.setItem('settings:v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('settings:v1') ?? '{}'), megszolitas: 'Kristóf' })); location.reload(); true`);
        await sleep(1500);
        await p.waitFor(q('[data-testid="account-card"]'), 60000, 'fiók');
        await sleep(800);
        await p.shot(`${DATE}-aw24-web-account-${state}-top-${w}.png`);
        await p.evaluate(`document.querySelector('[data-testid="privacy-group"]').scrollIntoView({ block: 'center' }); true`);
        await sleep(400);
        await p.shot(`${DATE}-aw24-web-account-${state}-privacy-${w}.png`);
        if (state === 'in') {
          await p.evaluate(`document.querySelector('[data-testid="account-signout"]').scrollIntoView({ block: 'end' }); true`);
          await sleep(400);
          await p.shot(`${DATE}-aw24-web-account-in-bottom-${w}.png`);
        }
        await p.close();
      }
    }
  }
} finally {
  await closeChrome(chrome);
}
