// AW24 F/H: a webes felső és alsó sáv valódi WebKit-motorral (Playwright WebKit), három méreten, négy módban – INV-22 és INV-23 őre.
// A Chromium-emuláció nem elég: az AW23-as kezdőképernyős javítást csak azzal mértük, és valódi WebKitben levágta az alsó sávot.
// A biztonsági sávot a betöltött CSS `env(safe-area-inset-*)` értékeinek átírása szimulálja (a WebKit-motor nézetablakában nincs kivágás).
// Használat: `npm run webkit:layout` (kapcsolók: --device se|pro|max, --shots: képek a docs/screenshots-ba). A valódi Mobile Safari-mérés: docs/ops/webkit-meres.md.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { webkit } from 'playwright-core';
import { DEVICES, pick, ROOT } from './config.mjs';

const argv = process.argv.slice(2);
const BASE = process.env.WEBKIT_BASE ?? 'http://localhost:5198';
const devices = pick(argv, 'device')?.split(',') ?? Object.keys(DEVICES);
const SHOTS = argv.includes('--shots');
const DATE = pick(argv, 'date') ?? new Date().toISOString().slice(0, 10);

/**
 * A négy webes mód (iOS 27 szimulátoron mérve, iPhone 17 Pro: Safari 714 pt magas tartalom eszköztárral és eszköztár nélkül is, a kezdőképernyős webapp
 * 874 pt, egyes indításoknál 812 pt). A Safari eszköztára 98 pt (Pro, mért); SE-n és Pro Max-en ugyanennyivel számolunk.
 * `h`: a látható nézetablak (`innerHeight`), `top` / `bottom`: a biztonsági sáv a nézetablakban.
 */
const MODES = {
  safari: (d) => ({ h: d.h - d.top - 98, top: 0, bottom: 0, standalone: false }),
  'safari-eszkoztar-nelkul': (d) => ({ h: d.h - d.top - 98, top: 0, bottom: 0, standalone: false }),
  kezdokepernyo: (d) => ({ h: d.h, top: d.top, bottom: d.bottom, standalone: true }),
  'kezdokepernyo-rovid': (d) => ({ h: d.h - d.top, top: d.top, bottom: d.bottom, standalone: true }),
};

const VIEWS = {
  ures: { path: '/?navsim&panel=0&heat=ki&speed=1', bottom: '.hud > .card' },
  navigacio: { path: '/?navsim&stage=nav&panel=0&speed=1&at=60', bottom: '.nav-bottom' },
};

let failed = 0;
let total = 0;
const check = (name, ok, info = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'HIBA'} ${name}${info ? ` – ${info}` : ''}`);
};

async function server() {
  if (await fetch(BASE).then((r) => r.ok).catch(() => false)) return null;
  const proc = spawn('npx', ['vite', '--port', new URL(BASE).port, '--strictPort'], { cwd: join(ROOT, 'apps', 'web'), stdio: 'ignore', detached: true });
  for (let i = 0; i < 120 && !(await fetch(BASE).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 500));
  return proc;
}

/** A dokumentum stíluslapjaiban a biztonsági sáv `env()` értékeit px-re cseréli (a vite stílus-címkéi és a később betöltöttek is). */
const safeAreaScript = ({ top, bottom, standalone }) => `
  (() => {
    ${standalone ? `Object.defineProperty(navigator, 'standalone', { value: true });` : ''}
    const v = { top: '${top}px', bottom: '${bottom}px', left: '0px', right: '0px' };
    const fix = (el) => { if (el.textContent && el.textContent.includes('safe-area-inset')) el.textContent = el.textContent.replace(/env\\(safe-area-inset-(top|bottom|left|right)\\)/g, (_, k) => v[k]); };
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === 'STYLE' && fix(n)))).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('style').forEach(fix));
  })();`;

const proc = await server();
const browser = await webkit.launch();
try {
  for (const dev of devices) {
    const d = DEVICES[dev];
    for (const [mode, of] of Object.entries(MODES)) {
      const m = of(d);
      for (const [view, v] of Object.entries(VIEWS)) {
        const ctx = await browser.newContext({ viewport: { width: d.w, height: m.h }, screen: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, locale: 'hu-HU' });
        await ctx.addInitScript({ content: safeAreaScript(m) });
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', (e) => errors.push(String(e)));
        await p.goto(BASE + v.path);
        await p.waitForSelector(v.bottom, { timeout: 60_000 });
        await p.waitForSelector('.mapboxgl-ctrl-logo', { timeout: 60_000 });
        await p.waitForTimeout(1500);
        const r = await p.evaluate(({ sel }) => {
          const box = (q) => {
            const e = document.querySelector(q);
            if (!e) return null;
            const b = e.getBoundingClientRect();
            return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) };
          };
          const hud = [...document.querySelectorAll('.hud *')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
          return {
            inner: innerHeight,
            app: box('.app'),
            bar: box(sel),
            logo: box('.mapboxgl-ctrl-logo'),
            info: box('.mapboxgl-ctrl-attrib-button'),
            scrim: box('.scrim-top'),
            maxHud: Math.round(Math.max(...hud.map((e) => e.getBoundingClientRect().bottom))),
          };
        }, { sel: v.bottom });
        const tag = `${dev} ${mode} ${view}`;
        // INV-23: az app a látható nézetablakot tölti ki, az alsó sáv alja a biztonsági sáv fölött 12 pt-re, semmi nem lóg ki alul
        check(`${tag}: az app magassága = a látható nézetablak`, r.app.top === 0 && r.app.h === r.inner && r.inner === m.h, JSON.stringify({ app: r.app, inner: r.inner }));
        check(`${tag}: az alsó sáv alja a biztonsági sáv fölött 12 pt-re`, r.bar.bottom === m.h - m.bottom - 12, JSON.stringify({ bar: r.bar.bottom, want: m.h - m.bottom - 12 }));
        check(`${tag}: semmi nem lóg ki alul`, r.maxHud <= m.h, `${r.maxHud} / ${m.h}`);
        // INV-22: a logó bal felül (a Mapbox-elem doboza −4 px margóval: 4, biztonsági sáv + 4, 88 × 23), az „i” jobb felül (24 pt, közepe W − 20, + 16), a felső sötétítés a biztonsági sáv + 140
        check(`${tag}: a Mapbox-logó helye`, r.logo.left === 4 && r.logo.top === m.top + 4 && r.logo.h === 23, JSON.stringify(r.logo));
        check(`${tag}: az „i” helye`, r.info.right === d.w - 8 && r.info.top === m.top + 4 && r.info.h === 24, JSON.stringify(r.info));
        check(`${tag}: a felső sötétítés`, r.scrim.top === 0 && r.scrim.h === m.top + 140, JSON.stringify(r.scrim));
        check(`${tag}: nincs JS-kivétel`, errors.length === 0, errors.join(' | '));
        if (SHOTS) await p.screenshot({ path: join(ROOT, 'docs', 'screenshots', `${DATE}-aw24-webkit-${dev}-${mode}-${view}.png`) });
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  if (proc) process.kill(-proc.pid);
}
console.log(`\n${total - failed}/${total} ellenőrzés zöld`);
process.exit(failed ? 1 : 0);
