// A Három képernyőméret szabály webes képei (CLAUDE.md): kezdőképernyő (HU, DE), Beállítások, zóna-választó, Bejelentés, Térképhiba, kompakt ajánlat
// a 320 × 568, 375 × 667, 390 × 844 és 430 × 932 nézeten. Használat: npm run view-shots -w @atlagsebesseg/web -- <képnév-előtag> [kimeneti mappa]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWatchdog } from './chrome-guard.mjs';
import { closeChrome, launchChrome, openPage, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const PREFIX = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const OUT = process.argv[3] ?? join(here, '..', '..', '..', 'docs', 'screenshots');
const VIEWS = [['320', 320, 568], ['kicsi', 375, 667], ['kozepes', 390, 844], ['nagy', 430, 932]];
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const SAVED = JSON.stringify({ home: { lat: 47.5, lon: 19.04, name: 'Budapest, Kossuth tér 1.', address: '' }, work: { lat: 47.45, lon: 19, name: 'Budaörs, Szabadság út 117.', address: '' }, others: [] });

startWatchdog(15, 'view-shots'); // kemény időkorlát (SHOTS_TIMEOUT_MIN felülírja)
const chrome = await launchChrome({ photo: true });
try {
  const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'photo' });
  for (const [tag, width, height] of VIEWS) {
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    const go = async (path, lang = 'hu') => {
      await p.send('Page.navigate', { url: `${BASE}/` });
      await sleep(400);
      await p.evaluate(`localStorage.clear(); localStorage.setItem('lang:v1', '${lang}'); localStorage.setItem('nav:saved:v1', ${JSON.stringify(SAVED)}); true`);
      await p.send('Page.navigate', { url: `${BASE}${path}` });
    };
    for (const lang of ['hu', 'en', 'de', 'sk', 'cs', 'pl']) {
      await go('/', lang);
      await p.waitFor(q('.start h1'), 30_000, 'kezdőképernyő');
      await sleep(lang === 'hu' || lang === 'de' ? 3500 : 800);
      if (lang === 'hu' || lang === 'de') await p.shot(`${PREFIX}-web-${tag}-kezdo-${lang}.png`);
      // a cím egy sorban, az oldalon belül; a kezdőképernyő görgetés nélkül kifér
      const fit = await p.evaluate(`(() => { const s = ${q('.start')}; const h = ${q('.start h1')}; const r = h.getBoundingClientRect(); return { oneLine: r.height < parseFloat(getComputedStyle(h).fontSize) * 1.5, inside: h.scrollWidth <= h.clientWidth + 1 && r.right <= innerWidth, fits: s.scrollHeight <= s.clientHeight + 1 }; })()`);
      if (!fit.oneLine || !fit.inside || !fit.fits) {
        console.log(`HIBA ${tag} ${lang}: kezdőképernyő ${JSON.stringify(fit)}`);
        process.exitCode = 1;
      }
    }
    await go('/?navsim&panel=0&sheet=settings');
    await p.waitFor(q('.zone-picker'), 30_000, 'Beállítások');
    await sleep(2500);
    await p.shot(`${PREFIX}-web-${tag}-beallitasok.png`);
    await p.evaluate(`${q('.zone-picker')}.scrollIntoView({ block: 'center' }); true`);
    await sleep(400);
    await p.shot(`${PREFIX}-web-${tag}-zona.png`);
    await go('/?sim=jo&panel=0');
    await p.waitFor(q('button[aria-label="Bejelentés"]'), 30_000, 'Bejelentés gomb');
    await sleep(4000);
    await p.evaluate(`${q('button[aria-label="Bejelentés"]')}.click(); true`);
    await p.waitFor(q('.sheet .tiles'), 5000, 'menü');
    await sleep(600);
    await p.shot(`${PREFIX}-web-${tag}-bejelentes.png`);
    await p.evaluate(`[...document.querySelectorAll('.sheet .tile')].find((e) => e.innerText.trim() === 'Térképhiba').click(); true`);
    await sleep(500);
    await p.shot(`${PREFIX}-web-${tag}-terkephiba.png`);
    await go('/?navsim&stage=nav&speed=1&panel=0');
    await p.waitFor(`window.__navSim?.windows`, 60_000, 'szimuláció');
    const { windows } = await p.evaluate(`window.__navSim`);
    // a teljes mérőkártya (ajánlat nélkül) sem lóghat ki
    await go(`/?navsim&stage=nav&speed=1&at=${windows[1] + 95}&panel=0`);
    await p.waitFor(`document.querySelector('.hud > .card[aria-label="Mérés"]')`, 120_000, 'mérőkártya');
    await sleep(1500);
    await p.shot(`${PREFIX}-web-${tag}-meres.png`);
    const full = await p.evaluate(`(() => { const c = document.querySelector('.hud > .card[aria-label="Mérés"]'); const r = c.getBoundingClientRect(); const spill = [...c.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > r.right + 1).length; return { spill, right: Math.round(r.right), w: innerWidth }; })()`);
    if (full.spill > 0 || full.right > full.w) {
      console.log(`HIBA ${tag}: mérőkártya ${JSON.stringify(full)}`);
      process.exitCode = 1;
    }
    // a mérőkártya egy sora (átlag, most, várható, tábla) a kártyán belül marad, a leghosszabb feliratú nyelven is
    for (const lang of ['hu', 'de']) {
      await go(`/?navsim&stage=nav&speed=12&alt=aftergate&at=${windows[1]}&panel=0`, lang);
      await p.waitFor(q('.nav-offer-compact'), 180_000, 'kompakt ajánlat');
      await sleep(800);
      await p.shot(`${PREFIX}-web-${tag}-ajanlat-${lang}.png`);
      const meter = await p.evaluate(`(() => { const row = ${q('.meter-compact')}; const c = row.closest('.card').getBoundingClientRect(); const s = row.querySelector('.sign').getBoundingClientRect(); const o = ${q('.nav-offer-compact .nav-offer-title')}.getBoundingClientRect(); return { signRight: Math.round(s.right), cardRight: Math.round(c.right), overflow: row.scrollWidth - row.clientWidth, titleW: Math.round(o.width) }; })()`);
      if (meter.signRight > meter.cardRight - 8 || meter.overflow > 0 || meter.titleW < 120) {
        console.log(`HIBA ${tag} ${lang}: mérőkártya/ajánlat ${JSON.stringify(meter)}`);
        process.exitCode = 1;
      }
    }
  }
  await p.close();
} finally {
  await closeChrome(chrome).catch(() => undefined);
}
