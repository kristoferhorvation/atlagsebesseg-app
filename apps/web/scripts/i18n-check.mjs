// Nyelvváltás ellenőrzése headless Chrome-ban (CDP, külső függőség nélkül; Node 22+ WebSocket):
//  1. a készülék nyelve szerinti kezdő nyelv (hu, pl, sk; nem támogatott → en);
//  2. hu → en váltás a Beállításokban: a felirat, a <html lang>, a tárolás, és újratöltés után is marad;
//  3. a települészóna sávja magyarul és angolul a szimulátorban;
//  4. a hang-sor a Beállításokban (a headless Chrome-nak nincs hangja → „nincs hang” jelzés).
//
//   npm run dev -w @atlagsebesseg/web              # másik terminálban
//   npm run i18n:check -w @atlagsebesseg/web
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeChrome, spawnGuardedChrome, startWatchdog } from './chrome-guard.mjs';

const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'atlag-i18n-'));
  // az őr (chrome-guard.mjs): árva Chrome kilövése indításkor, takarítás signalnál / kilépésnél, sikertelen indulásnál is
  const { proc } = await spawnGuardedChrome(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'],
    { profile, port: PORT, attempts: 50 },
  );
  return { proc, profile };
}

async function openPage(acceptLanguage) {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const ua = await evaluate('navigator.userAgent');
  await send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage });
  return {
    evaluate,
    /** Betöltés tiszta tárhellyel; `store`: előre beállított localStorage-értékek. */
    async goto(path, store = {}) {
      await send('Page.navigate', { url: `${BASE}/` });
      await sleep(300);
      await evaluate(`localStorage.clear(); ${Object.entries(store).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(' ')} true`);
      await send('Page.navigate', { url: `${BASE}${path}` });
    },
    async reload() {
      await send('Page.reload');
    },
    async waitFor(expr, timeoutMs = 30_000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try {
          if (await evaluate(`!!(${expr})`)) return;
        } catch {
          // az oldal még tölt
        }
        await sleep(150);
      }
      throw new Error(`időtúllépés: ${label}`);
    },
    // a lap is bezárul, nem csak a kapcsolat
    close: async () => {
      ws.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
    },
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK ' : 'HIBA'}  ${name}${detail ? ` – ${detail}` : ''}`);
}

const LANG = `document.documentElement.lang`;
const TITLE = `document.querySelector('.start h1')?.textContent`;
const BAND = `document.querySelector('.planned-band')?.innerText.replace(/\\s+/g, ' ').trim()`;

startWatchdog(15, 'i18n-check'); // kemény időkorlát (SHOTS_TIMEOUT_MIN felülírja)
const { proc, profile } = await launch();
try {
  // 1. kezdő nyelv a készülék nyelvéből
  for (const [accept, want] of [['hu-HU,hu', 'hu'], ['pl-PL,pl', 'pl'], ['sk-SK,sk', 'sk'], ['cs-CZ,cs', 'cs'], ['de-AT,de', 'de'], ['fr-FR,fr', 'en']]) {
    const p = await openPage(accept);
    await p.goto('/');
    await p.waitFor(`document.querySelector('.start')`);
    check(`Accept-Language ${accept} → ${want}`, (await p.evaluate(LANG)) === want, `<html lang="${await p.evaluate(LANG)}">, „${await p.evaluate(TITLE)}”`);
    p.close();
  }

  // 2. hu → en váltás a Beállításokban
  const p = await openPage('hu-HU,hu');
  await p.goto('/');
  await p.waitFor(`document.querySelector('.start .btn.primary')`);
  check('indulóképernyő magyarul', (await p.evaluate(`document.querySelector('.start .btn.primary').textContent`)) === 'Indulás');
  await p.evaluate(`document.querySelector('.start .btn.primary').click(); true`);
  await p.waitFor(`document.querySelector('[aria-label="Beállítások"]')`);
  await p.evaluate(`document.querySelector('[aria-label="Beállítások"]').click(); true`);
  await p.waitFor(`document.querySelector('.sheet select.select')`);
  check('Beállítások magyarul', (await p.evaluate(`document.querySelector('.sheet .title').textContent`)) === 'Beállítások');
  const options = await p.evaluate(`[...document.querySelectorAll('.sheet .select option')].map((o) => o.textContent)`);
  // AW15: zászló + saját név, ábécérendben; az „Automatikus” legfelül
  check(
    'a választóban az automatikus, utána mind a 6 nyelv zászlóval, ábécérendben',
    options.length === 7 && /^Automatikus/.test(options[0]) && options.slice(1).join('|') === '🇨🇿 Čeština|🇩🇪 Deutsch|🇬🇧 English|🇭🇺 Magyar|🇵🇱 Polski|🇸🇰 Slovenčina',
    options.join(' | '),
  );
  const voice = await p.evaluate(`document.querySelector('.hint[data-voice]')?.textContent`);
  const voiceKind = await p.evaluate(`document.querySelector('.hint[data-voice]')?.dataset.voice`);
  // AW17: nincs külön „Hang” sor – a hang elérhetősége zárójelben a „Hangos utasítások” leírásának végén
  check(
    'hang-info zárójelben a „Hangos utasítások” leírásában, külön „Hang” sor nélkül',
    /^Fordulók, .*\(.+\)$/.test(voice ?? '') && !(await p.evaluate(`document.querySelector('.sheet').innerText`)).includes('Hang (hangos utasítások)'),
    `${voiceKind}: ${voice}`,
  );
  await p.evaluate(`(() => { const s = document.querySelector('.sheet select.select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'en'); s.dispatchEvent(new Event('change', { bubbles: true })); })(); true`);
  await p.waitFor(`document.querySelector('.sheet .title')?.textContent === 'Settings'`, 5000, 'angol cím');
  check('váltás után a Beállítások angolul', true, await p.evaluate(`document.querySelector('.sheet .title').textContent`));
  check('<html lang> és a tárolt érték en', (await p.evaluate(LANG)) === 'en' && (await p.evaluate(`localStorage.getItem('lang:v1')`)) === 'en');
  check('a felirat a Beállításokban angol (tűrés, egység)', /Show official tolerance/.test(await p.evaluate(`document.querySelector('.sheet').innerText`)) && /Unit/.test(await p.evaluate(`document.querySelector('.sheet').innerText`)));
  await p.evaluate(`document.querySelector('.sheet [aria-label="Close"]').click(); true`);
  await p.waitFor(`!document.querySelector('.sheet')`, 5000, 'lap bezár');
  const hud = await p.evaluate(`document.querySelector('.card')?.innerText.replace(/\\s+/g, ' ')`);
  check('a HUD is angol', /No section nearby|Waiting for GPS/.test(hud ?? ''), hud);
  await p.reload();
  await p.waitFor(`document.querySelector('.start')`);
  check('újratöltés után is angol (tárolva)', (await p.evaluate(LANG)) === 'en' && (await p.evaluate(`document.querySelector('.start .btn.primary').textContent`)) === 'Start');
  p.close();

  // 3. települészóna-sáv a szimulátorban, hu és en
  for (const [lang, re] of [
    ['hu', /^Rendőrségi mérés Mintaváros területén · .+ · forrás: police\.hu$/],
    ['en', /^Police check in Mintaváros · .+ · source: police\.hu$/],
    ['de', /^Polizeikontrolle in Mintaváros · .+ · Quelle: police\.hu$/],
  ]) {
    const z = await openPage('hu-HU,hu');
    await z.goto('/?sim=zona&route=0&speed=12&panel=0', { 'lang:v1': lang });
    await z.waitFor(`document.querySelector('.planned-band')?.dataset.show === 'true'`, 90_000, 'zóna-sáv');
    const text = await z.evaluate(BAND);
    check(`zóna-sáv (${lang})`, re.test(text) && (await z.evaluate(`document.querySelector('.planned-band').dataset.zone`)) === 'true', text);
    z.close();
  }

  // 4. AW21: minden képernyő / állapot minden nyelven – egyetlen megjelenő szöveg sem lehet a hu.json értéke (kivéve a szótárban
  //    szándékosan azonosakat), és ő / ű betű sincs a nem magyar nyelvű szövegben.
  const dict = (l) => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'app-logic', 'src', 'i18n', `${l}.json`), 'utf8'));
  const huDict = dict('hu');
  const SCREENS = [
    ['kezdőképernyő', '/', null],
    ['térkép + mérőkártya', '/?navsim&panel=0', '.card'],
    ['Beállítások', '/?navsim&panel=0&sheet=settings', '.sheet .title'],
    ['Utak naplója', '/?navsim&panel=0&sheet=trips', '.sheet .title'],
    ['Részletek (adatmegosztás)', '/?navsim&panel=0&sheet=heatDetails', '.sheet .title'],
    ['Bejelentés lap', '/?navsim&panel=0', '.card', '.round-btn.report', '.sheet .tiles'],
    ['navigáció + ajánlat', '/?navsim&stage=nav&alt=worth&panel=0&speed=7&at=60', '.nav-top'],
    ['navigáció + dugó', '/?navsim&stage=nav&traffic&panel=0&speed=7&at=60', '.nav-top'],
  ];
  const collect = `(() => {
    const out = new Set();
    const add = (t) => { const v = (t ?? '').replace(/\\s+/g, ' ').trim(); if (v) out.add(v); };
    document.querySelectorAll('body *').forEach((e) => { if (e.children.length === 0) add(e.textContent); });
    document.querySelectorAll('[aria-label],[title],[placeholder],[alt]').forEach((e) => ['aria-label', 'title', 'placeholder', 'alt'].forEach((a) => add(e.getAttribute(a))));
    document.querySelectorAll('select option').forEach((o) => add(o.textContent));
    return [...out];
  })()`;
  for (const lang of ['en', 'de', 'sk', 'cs', 'pl']) {
    const own = dict(lang);
    const huOnly = new Set(Object.entries(huDict).filter(([k, v]) => own[k] !== v && /\p{L}{3}/u.test(v) && v.length >= 4).map(([, v]) => v));
    for (const [name, path, ready, click, after] of SCREENS) {
      const q = await openPage(`${lang}-${lang.toUpperCase()},${lang}`);
      try {
        await q.goto(path, { 'lang:v1': lang });
        if (ready) await q.waitFor(`document.querySelector(${JSON.stringify(ready)})`, 90_000, `${name} (${lang})`);
        else await q.waitFor(`document.querySelector('.start')`);
        if (click) {
          await q.evaluate(`document.querySelector(${JSON.stringify(click)}).click(); true`);
          await q.waitFor(`document.querySelector(${JSON.stringify(after)})`, 15_000, `${name} lap`);
        }
        await sleep(800);
        const texts = await q.evaluate(collect);
        const bad = texts.filter((t) => huOnly.has(t) || /[őűŐŰ]/.test(t));
        check(`${lang}: ${name} – nincs magyar szöveg`, bad.length === 0, bad.length ? `magyar: ${JSON.stringify(bad)}` : `${texts.length} szöveg`);
      } catch (e) {
        check(`${lang}: ${name} – nincs magyar szöveg`, false, String(e.message ?? e));
      } finally {
        await q.close();
      }
    }
  }
} finally {
  await closeChrome({ proc, profile }).catch(() => undefined);
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} ellenőrzés zöld`);
process.exit(failed ? 1 : 0);
