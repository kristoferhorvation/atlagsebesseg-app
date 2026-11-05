// AW23: a gombsor mind a négy kombinációja, a követő kamera és a jelölő képkockánkénti mérése a valódi nyomaton (éles kódúton: nem szimulátor,
// a böngésző helyzet-API-ja adja a fixeket). Fut a dev-szerver; képek: docs/screenshots/<dátum>-aw23-web-*.png. Hibakóddal áll le.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeChrome, launchChrome, openPage, sleep } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const DATE = new Date().toISOString().slice(0, 10);
const SIZES = [[320, 667], [375, 667], [402, 874], [440, 956]];
const trace = JSON.parse(readFileSync(join(ROOT, 'packages/app-logic/src/fixtures/gps-trace-1hz.json'), 'utf8'));
const only = process.argv[2];
const q = (s) => `document.querySelector(${JSON.stringify(s)})`;
let ok = 0;
let bad = 0;
const check = (name, pass, detail = '') => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? 'OK ' : 'HIBA'} ${name}${pass ? '' : ` ${detail}`}`);
};

const rectOf = (sel) => `(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; })()`;
const overlap = (a, b) => a && b && a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

async function drag(p, w, topSel) {
  const m = (type, x, y, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1, ...extra });
  const y = await p.evaluate(`Math.round((${q(topSel)}?.getBoundingClientRect().bottom ?? 120) + 12)`);
  await m('mousePressed', w / 2 - 60, y);
  await m('mouseMoved', w / 2 - 20, y + 12);
  await m('mouseMoved', w / 2 + 40, y + 24);
  await m('mouseReleased', w / 2 + 40, y + 24, { buttons: 0 });
  await p.waitFor(q('.recenter'), 15000, 'Vissza gomb');
}

const chrome = await launchChrome({ photo: false });
try {
  if (!only || only === 'actions') {
    // nav: navigáció; ures: navigáción kívül (a ManualMini ott `miniAlways`-szel jelenik meg, csak a méréshez)
    for (const [w, h] of SIZES) {
      for (const mode of ['ures', 'nav']) {
        const base = {};
        for (const [mini, vissza] of [[false, false], [false, true], [true, false], [true, true]]) {
          const name = `${w}-${mode}-mini${mini ? 1 : 0}-vissza${vissza ? 1 : 0}`;
          const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'blank' });
          await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
          await p.goto(mode === 'nav' ? '/?navsim&stage=nav&panel=0&speed=1&at=60' : '/?navsim&panel=0&heat=ki&speed=1&miniAlways');
          await p.waitFor(q('.actions .report'), 60000, 'gombsor');
          await sleep(700);
          if (mini) {
            await p.evaluate(`${q('button[aria-label="Kézi átlagmérés indítása"]')}.click(); true`);
            await p.waitFor(q('.hud > .card[aria-label="Kézi átlagmérés"] .chip'), 15000, 'kézi kártya');
            await p.evaluate(`${q('.hud > .card[aria-label="Kézi átlagmérés"] .chip')}.click(); true`);
            await p.waitFor(q('.manual-mini'), 15000, 'mini');
          }
          if (vissza) await drag(p, w, mode === 'nav' ? '.nav-top' : '.pills');
          await sleep(500);
          const rep = await p.evaluate(rectOf('.actions .report'));
          // a lépés-sáv a manőverkártya magasságától függ (a lejátszás halad), nem a két gombtól: a mérés nélküle számol
          const strip = await p.evaluate(`(() => { const e = ${q('.nav-strip')}; return e ? e.offsetHeight + 12 : 0; })()`);
          rep.y += strip;
          rep.b += strip;
          const hudH = await p.evaluate(`${q('.hud')}.offsetHeight`);
          const slot = await p.evaluate(rectOf('.recenter-slot'));
          const miniR = await p.evaluate(rectOf('.manual-mini'));
          const card = await p.evaluate(rectOf('.hud > .card'));
          const sign = await p.evaluate(rectOf('.actions-upper .sign'));
          const key = mini ? 'mini' : 'plain';
          base[key] ??= rep;
          check(`${name}: az alsó sor nem mozdul`, rep.x === base[key].x && rep.y === base[key].y, JSON.stringify({ rep, base: base[key], hudH }));
          check(`${name}: a Bejelentés a jobb szélen`, w - rep.r === 12, JSON.stringify(rep));
          check(`${name}: a „Vissza a helyemre” helye pontosan a Bejelentés fölött`, slot.x === rep.x && rep.y - strip - slot.b === 12, JSON.stringify({ slot, rep }));
          if (mini) check(`${name}: a ManualMini a hely mellett balra, 12 px-re`, slot.x - miniR.r === 12, JSON.stringify({ miniR, slot }));
          check(`${name}: semmi nem fedi egymást`, !overlap(miniR, card) && !overlap(miniR, sign) && !overlap(slot, sign) && !overlap(slot, card), JSON.stringify({ miniR, slot, sign, card }));
          await p.shot(`${DATE}-aw23-web-gombsor-${name}.png`);
          await p.close();
        }
      }
    }
  }

  if (!only || only === 'views') {
    // a kör képei: panel, kereső, útvonalválasztó, dugó-kérdés, kamera (valódi térkép 2D-ben)
    const VIEWS = {
      panel: { path: '/?navsim&stage=nav&panel=0&speed=1&at=60', ready: '.nav-bottom', click: '.nav-bottom-eta', after: '.nav-panel' },
      valaszto: { path: '/?navsim&stage=picker&fasterAlt&panel=0&speed=1', ready: '.route-opt' },
      ures: { path: '/?navsim&panel=0&heat=ki&speed=1', ready: '.compact-row' },
      krusing: { path: '/?cruise&panel=0&heat=ki&speed=2&at=300', ready: '.cruise-status' },
      navigacio: { path: '/?navsim&stage=nav&panel=0&speed=1&at=60', ready: '.nav-top' },
      'dugo-kerdes': { path: '/?navsim&stage=nav&traffic&panel=0&speed=4', ready: `[...document.querySelectorAll('.jam-ask-row')].find((e) => e.innerText.trim())`, raw: true },
    };
    for (const [w, h] of [[320, 667], [402, 874], [440, 956]]) {
      for (const [name, v] of Object.entries(VIEWS)) {
        const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'real' });
        await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
        await p.goto(v.path);
        await p.waitFor(v.raw ? v.ready : q(v.ready), 180000, name);
        if (v.click) {
          await sleep(500);
          await p.evaluate(`${q(v.click)}.click(); true`);
          await p.waitFor(q(v.after), 10000, v.after);
        }
        await sleep(v.raw ? 300 : 2500);
        await p.shot(`${DATE}-aw23-web-${w}-${name}.png`);
        await p.close();
      }
      // kereső, gépelt szöveggel
      const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'real' });
      await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
      await p.goto('/?navsim&panel=0&heat=ki&speed=1');
      await p.waitFor(q('.compact-row'), 60000, 'térkép');
      await p.evaluate(`${q('.top-search')}.click(); true`);
      await p.waitFor(q('.search-field input'), 10000, 'kereső');
      await sleep(600);
      await p.shot(`${DATE}-aw23-web-${w}-kereses.png`);
      await p.close();
    }
  }

  if (!only || only === 'camera') {
    // a jelölő képernyő-helye minden állapotban a sávban: a legfelső alsó kártya fölött, a képernyő alsó részén
    const STATES = { ures: '/?navsim&panel=0&heat=ki&speed=1', krusing: '/?cruise&panel=0&heat=ki&speed=2&at=300', navigacio: '/?navsim&stage=nav&panel=0&speed=1&at=60' };
    for (const [w, h] of SIZES) {
      for (const [state, path] of [...Object.entries(STATES), ['nav-vege', '/?navsim&stage=nav&panel=0&speed=1&at=60']]) {
        const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'blank' });
        await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
        await p.goto(path);
        await p.waitFor(q('.puck'), 60000, 'jelölő');
        if (state === 'nav-vege') {
          await p.waitFor(q('.nav-end'), 30000, 'navigáció');
          await sleep(500);
          await p.evaluate(`${q('.nav-end')}.click(); true`);
        }
        await sleep(2500);
        const m = await p.evaluate(`(() => { const r = ${q('.puck-dot')}.getBoundingClientRect(); const c = ${q('.hud > .card')}?.getBoundingClientRect(); return { y: (r.top + r.bottom) / 2, x: (r.left + r.right) / 2, cardTop: c?.top ?? null, h: innerHeight, w: innerWidth }; })()`);
        const yFrac = m.y / m.h;
        check(`${w}x${h} ${state}: a jelölő a képernyő alsó részén (${yFrac.toFixed(2)})`, yFrac >= 0.55 && yFrac <= 0.82, JSON.stringify(m));
        check(`${w}x${h} ${state}: a jelölő középen`, Math.abs(m.x - m.w / 2) < 3, JSON.stringify(m));
        if (m.cardTop !== null) check(`${w}x${h} ${state}: a jelölő a kártya fölött`, m.y < m.cardTop - 20, JSON.stringify(m));
        await p.close();
      }
    }
  }

  if (!only || only === 'standalone') {
    // kezdőképernyős mód és böngésző: a térkép a teljes kijelzőt kitölti, az alsó sáv alja a biztonsági sáv fölött 12 px-re (mint iOS-en), nincs dupla sáv
    for (const [w, h, safe] of [[375, 667, 0], [402, 874, 34], [440, 956, 34]]) {
      for (const mode of ['standalone', 'safari']) {
        const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'blank' });
        // standalone: a nézetablak a rendszercsíknyival rövidebb a kijelzőnél (az iPhone 16 Pro Max-en mért hiba)
        await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: mode === 'standalone' ? h - safe : h, screenWidth: w, screenHeight: h, deviceScaleFactor: 2, mobile: true });
        await p.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: safe } });
        if (mode === 'standalone') await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'standalone', { value: true });` });
        await p.goto('/?navsim&stage=nav&panel=0&speed=1&at=60');
        await p.waitFor(q('.nav-bottom'), 60000, 'alsó sáv');
        await sleep(800);
        const m = await p.evaluate(`({ app: ${q('.app')}.getBoundingClientRect().height, map: ${q('.app > .map')}.getBoundingClientRect().height, bar: ${q('.nav-bottom')}.getBoundingClientRect().bottom })`);
        const full = mode === 'standalone' ? h : h;
        check(`${w}x${h} ${mode}: a térkép a teljes kijelzőt kitölti`, m.app === full && m.map === full, JSON.stringify(m));
        check(`${w}x${h} ${mode}: az alsó sáv alja a biztonsági sáv fölött 12 px-re`, m.bar === full - safe - 12, JSON.stringify(m));
        await p.close();
      }
    }
  }

  if (!only || only === 'wrap') {
    // AW23: ami nincs sortörésre tervezve, az nem törik: minden nyelven, a legkisebb és a legnagyobb méreten
    const ONE_LINE = ['.compact-row .body', '.nav-bottom-eta .fit-text', '.route-opt-tag', '.route-opt-main > span.num', '.route-opt-main b', '.nav-delay', '.cruise-status', '.greeting', '.nav-then span', '.pill-text', '.nav-strip .nav-road'];
    const VIEWS = { ures: ['/?navsim&panel=0&heat=ki&speed=1', '.compact-row'], krusing: ['/?cruise&panel=0&heat=ki&speed=2&at=300', '.cruise-status'], navigacio: ['/?navsim&stage=nav&panel=0&speed=1&at=60', '.nav-top'], valaszto: ['/?navsim&stage=picker&panel=0&speed=1', '.route-opt'] };
    for (const lang of ['hu', 'en', 'de', 'sk', 'cs', 'pl']) {
      for (const [w, h] of [[320, 667], [440, 956]]) {
        for (const [view, [path, ready]] of Object.entries(VIEWS)) {
          const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'blank' });
          await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
          await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('lang:v1', ${JSON.stringify(lang)}); } catch {}` });
          await p.goto(path);
          await p.waitFor(q(ready), 60000, ready);
          await sleep(1200);
          const broken = await p.evaluate(`(() => { const out = []; for (const s of ${JSON.stringify(ONE_LINE)}) for (const e of document.querySelectorAll(s)) { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue; const r = document.createRange(); r.selectNodeContents(e); const tops = [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1).map((x) => x.bottom); const lines = tops.length ? Math.max(...tops) - Math.min(...tops) : 0; const clipped = e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible'; if (lines > 6 || clipped) out.push(s + ': ' + e.textContent.slice(0, 40)); } return out; })()`);
          check(`${lang} ${w} ${view}: nem törik`, broken.length === 0, JSON.stringify(broken));
          await p.close();
        }
      }
    }
  }

  if (!only || only === 'frames') {
    // a valódi 1 Hz-es nyomat visszajátszása: éles kódút, a böngésző helyzet-API-ját cseréljük
    for (const tr of trace.traces) {
      const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: 'blank' });
      await p.send('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 1, mobile: true });
      await p.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__frameLog = [];
          (() => {
            const raw = ${JSON.stringify(tr.fixes.slice(0, 40))};
            const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b[1] - a[1]) * r, dLo = (b[2] - a[2]) * r, s = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
            const watch = (ok) => {
              let i = 0;
              setInterval(() => {
                if (i >= raw.length) return;
                const f = raw[i], q = raw[i - 1];
                const d = q ? hav(q, f) : 0;
                const heading = q && d > 1 ? ((Math.atan2((f[2] - q[2]) * Math.cos(f[1] * Math.PI / 180), f[1] - q[1]) * 180) / Math.PI + 360) % 360 : null;
                i++;
                ok({ coords: { latitude: f[1], longitude: f[2], accuracy: 5, speed: d, heading, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() });
              }, 1000);
              return 1;
            };
            Object.defineProperty(navigator, 'geolocation', { value: { watchPosition: watch, clearWatch() {}, getCurrentPosition() {} } });
          })();`,
      });
      await p.goto('/');
      await p.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Indulás')`, 30000, 'kezdőképernyő');
      await p.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Indulás').click(); true`);
      await p.waitFor(q('.puck'), 30000, 'jelölő');
      await sleep(30_000);
      const f = await p.evaluate(`window.__frameLog`);
      const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r, s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
      let worst = 0;
      let bads = 0;
      let moving = 0;
      for (let i = 1; i < f.length; i++) {
        const d = hav(f[i - 1], f[i]);
        const dt = f[i].t - f[i - 1].t;
        const limit = 2 * Math.max(f[i].v, 1) * dt / 1000 + 1e-6;
        if (d > 0) moving++;
        if (d > limit) bads++;
        worst = Math.max(worst, d / (limit / 2));
      }
      const fps = (f.length - 1) / ((f.at(-1).t - f[0].t) / 1000);
      check(`${tr.name}: ${f.length} képkocka, ${fps.toFixed(0)} fps, nincs a várható elmozdulás kétszerését elérő ugrás (legrosszabb ${worst.toFixed(2)}×)`, bads === 0 && moving > 100, JSON.stringify({ bads, moving }));
      await p.close();
    }
  }
} finally {
  await closeChrome(chrome);
}
console.log(`${ok}/${ok + bad} ellenőrzés zöld`);
process.exit(bad ? 1 : 0);
