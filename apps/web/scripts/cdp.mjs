// Headless Chrome iPhone-méretben (390 × 844, 3×), CDP-n – külső függőség nélkül (Node 22+ WebSocket).
// A navigációs képernyőkép-szkript (nav-shots.mjs) közös alapja; a shots.mjs saját másolatot használ.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND_TIMEOUT_MS = 180_000;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** `photo`: képkészítő mód – az éles megjelenés, ezért nincs GPU-kompozitálás-kikapcsolás (DPR 3-nál az nagyon lassú). */
export async function launchChrome({ photo = false } = {}) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = await mkdtemp(join(tmpdir(), 'atlag-nav-'));
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // AW20: kevesebb erőforrás – V8-halom korlát, nincs GPU-kompozitálás (NAV_GPU_COMPOSITING=1 visszakapcsolja), háttér-munka le
    '--js-flags=--max-old-space-size=512',
    ...(photo || process.env.NAV_GPU_COMPOSITING ? [] : ['--disable-gpu-compositing']),
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    'about:blank',
  ]);
  // zárolt / alvó kijelzőnél az indulás 10 s fölött is lehet: legfeljebb 30 s-ot várunk
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return { proc, profile, port };
    } catch {
      // még indul
    }
    await sleep(200);
  }
  throw new Error('a Chrome nem indult el');
}

export async function closeChrome({ proc, profile }) {
  proc.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}

/** A (legfeljebb egy) nyitott lap: új lap csak a régi tényleges bezárása után nyílhat. */
let openPageNow = null;

/**
 * Egy lap CDP-kapcsolattal; `base` a dev-szerver címe, `outDir` a képek helye.
 * `map`: `blank` (üres helyi stílus, DPR 1 – az app logikáját mérő ellenőrzések), `real` (valódi stílus, 2D, DPR 1 –
 * a térképet magát mérők), `photo` (az éles megjelenés, DPR 3 – képkészítés).
 */
export async function openPage({ port, base, outDir, map = 'blank' }) {
  if (openPageNow) throw new Error(`már van nyitott lap (${openPageNow}) – előbb await-tel zárd be`);
  openPageNow = map;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`kivétel: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  // időkorláttal: a válasz nélkül maradt hívás (pl. be nem fejeződő Promise) hibát ad, nem akasztja meg a futást a végtelenségig
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      const timer = setTimeout(() => {
        pending.delete(mid);
        reject(new Error(`CDP-időtúllépés (${SEND_TIMEOUT_MS / 1000} s): ${method} ${String(params.expression ?? '').slice(0, 120)}`));
      }, SEND_TIMEOUT_MS);
      pending.set(mid, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: map === 'photo' ? 3 : 1, mobile: true });
  if (map !== 'photo') await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__mapTest = ${JSON.stringify(map)};` });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, ...(map === 'photo' ? [] : [{ name: 'prefers-reduced-motion', value: 'reduce' }])] });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    send,
    evaluate,
    logs,
    async goto(path, settings) {
      await send('Page.navigate', { url: `${base}/` });
      // a localStorage-írás előtt a lapnak a saját eredetén kell állnia (fix 300 ms helyett pollozva)
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`location.href.startsWith(${JSON.stringify(base)}) && document.readyState !== 'loading'`).catch(() => false)) break;
        await sleep(20);
      }
      // magyar nyelv, a beállítás a betöltés előtt, a DE-figyelmeztetés már „látott”
      await evaluate(`localStorage.clear(); localStorage.setItem('lang:v1', 'hu'); ${settings ? `localStorage.setItem('settings:v1', ${JSON.stringify(JSON.stringify(settings))});` : ''} true`);
      await send('Page.navigate', { url: `${base}${path}` });
    },
    async waitFor(expr, timeoutMs = 60_000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (await evaluate(`(() => { try { return !!(${expr}); } catch { return false; } })()`)) return;
        await sleep(100);
      }
      throw new Error(`időtúllépés: ${label}`);
    },
    async type(text) {
      await send('Input.insertText', { text });
    },
    async shot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, file), Buffer.from(data, 'base64'));
      console.log(`  kép: docs/screenshots/${file}`);
    },
    // a lap is bezárul, nem csak a kapcsolat: a nyitva hagyott térképes lapok tovább futnak és terhelik a gépet
    async close() {
      ws.close();
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
      // megvárjuk, amíg a lap tényleg eltűnik a listából
      for (let i = 0; i < 50; i++) {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
        if (!list.some((t) => t.id === target.id)) break;
        await sleep(100);
      }
      openPageNow = null;
    },
  };
}
