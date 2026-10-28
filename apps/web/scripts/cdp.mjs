// Headless Chrome iPhone-méretben (390 × 844, 3×), CDP-n – külső függőség nélkül (Node 22+ WebSocket).
// A navigációs képernyőkép-szkript (nav-shots.mjs) közös alapja; a shots.mjs saját másolatot használ.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launchChrome() {
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
    'about:blank',
  ]);
  for (let i = 0; i < 50; i++) {
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

/** Egy lap CDP-kapcsolattal; `base` a dev-szerver címe, `outDir` a képek helye. */
export async function openPage({ port, base, outDir }) {
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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
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
      await sleep(300);
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
    close: () => ws.close(),
  };
}
