// Headless Chrome iPhone-méretben (390 × 844, 3×), CDP-n – külső függőség nélkül (Node 22+ WebSocket).
// 1. ellenőrzések a szimulátorban: fix kamera-ikonok, bejelentés-ikonok, a tervezett-mérés sáv be / kicsi / ki,
//    a „Tervezett mérések mutatása” kapcsoló kikapcsolva a sáv nem jelenik meg;
// 2. marketing-képernyőképek a docs/screenshots/ mappába (dátummal), szimulátor-panel nélkül.
//
//   npm run dev -w @atlagsebesseg/web            # másik terminálban (a Mapbox-token az apps/web/.env-ben)
//   npm run shots -w @atlagsebesseg/web          # ellenőrzés + képek
//   npm run shots -w @atlagsebesseg/web -- --check-only
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHECK_ONLY = process.argv.includes('--check-only');
const OUT = join(here, '..', '..', '..', 'docs', 'screenshots');
const DATE = new Date().toISOString().slice(0, 10);
const PORT = 9300 + Math.floor(Math.random() * 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'atlag-shots-'));
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ]);
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return { proc, profile };
    } catch {
      // még indul
    }
    await sleep(200);
  }
  throw new Error('a Chrome nem indult el');
}

/** Egy lap CDP-kapcsolattal. */
async function openPage() {
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    send,
    evaluate,
    async goto(path, settings) {
      await send('Page.navigate', { url: `${BASE}/` });
      await sleep(300);
      // a beállítás a betöltés előtt (localStorage), a DE-figyelmeztetés már „látott”
      // és magyar nyelv (a készülék nyelvét az alkalmazás felismeri – az ellenőrzések és a képek magyarok)
      await evaluate(`localStorage.clear(); localStorage.setItem('lang:v1', 'hu'); ${settings ? `localStorage.setItem('settings:v1', ${JSON.stringify(JSON.stringify(settings))});` : ''} true`);
      await send('Page.navigate', { url: `${BASE}${path}` });
    },
    /** Várakozás egy feltételre (JS-kifejezés), pollozva. */
    async waitFor(expr, timeoutMs = 60_000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (await evaluate(`(() => { try { return !!(${expr}); } catch { return false; } })()`)) return;
        await sleep(150);
      }
      throw new Error(`időtúllépés: ${label}`);
    },
    async shot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await mkdir(OUT, { recursive: true });
      await writeFile(join(OUT, file), Buffer.from(data, 'base64'));
      console.log(`  kép: docs/screenshots/${file}`);
    },
    close: () => ws.close(),
  };
}

const BAND_SHOWN = `document.querySelector('.planned-band')?.dataset.show === 'true'`;
const BAND_BIG = `${BAND_SHOWN} && document.querySelector('.planned-band').dataset.compact === 'false'`;
const BAND_SMALL = `${BAND_SHOWN} && document.querySelector('.planned-band').dataset.compact === 'true'`;
const BAND_TEXT = `document.querySelector('.planned-band')?.innerText.replace(/\\s+/g, ' ').trim()`;
/** Látható (a nézetben lévő) jelölők száma. */
const inView = (sel) =>
  `[...document.querySelectorAll('${sel}')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).length`;
const MAP_READY = `document.querySelector('.mapboxgl-canvas') && document.querySelector('.puck')`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'HIBA'}  ${name}${detail ? ` – ${detail}` : ''}`);
}

const { proc, profile } = await launch();
try {
  // --- 1. ellenőrzések (gyors lejátszás) ---
  const p = await openPage();
  await p.goto('/?sim=tervezett&route=0&speed=12&panel=0');
  await p.waitFor(MAP_READY, 60_000, 'térkép');
  check('a sáv induláskor rejtve', !(await p.evaluate(BAND_SHOWN)));
  await p.waitFor(BAND_BIG, 60_000, 'nagy sáv');
  const text = await p.evaluate(BAND_TEXT);
  check('a sáv megjelenik a vonalra érve (nagy)', /Tervezett rendőrségi mérés/.test(text) && /max \d+/.test(text), text);
  check('a kártya nem mérés közben: nincs szakasz-mérés', !(await p.evaluate(`!!document.querySelector('.slowdown[data-show="true"]')`)));
  await p.waitFor(BAND_SMALL, 90_000, 'kicsi sáv mérés közben');
  check('mérés közben a sáv kicsi', true);
  await p.waitFor(`!(${BAND_SHOWN})`, 120_000, 'a sáv eltűnik');
  check('letéréskor / a vonal végén a sáv eltűnik', true);
  const cams = await p.evaluate(`document.querySelectorAll('.camera-pin').length`);
  check('fix kamera-ikonok a térképen', cams >= 3, `${cams} db`);
  const reps = await p.evaluate(`document.querySelectorAll('.report-pin').length`);
  check('bejelentés-ikonok a térképen', reps >= 5, `${reps} db`);
  const camStyle = await p.evaluate(
    `(() => { const c = getComputedStyle(document.querySelector('.camera-pin-disc')); const r = getComputedStyle(document.querySelector('.report-pin-disc')); return [c.width, r.width]; })()`,
  );
  check('a kamera-ikon kisebb a bejelentés-ikonnál', parseFloat(camStyle[0]) < parseFloat(camStyle[1]), camStyle.join(' < '));
  // koppintás egy kamerára → kártya típussal és forrással
  await p.evaluate(`document.querySelector('.camera-pin').click(); true`);
  await p.waitFor(`document.querySelector('.camera-card')`, 5000, 'kamera-kártya');
  const card = await p.evaluate(`document.querySelector('.camera-card').innerText.replace(/\\s+/g, ' ')`);
  check('koppintásra kártya: típus és forrás', /kamera|ellenőrző pont|kapu/i.test(card) && /Hivatalos forrás|OpenStreetMap|VÉDA/.test(card), card);
  p.close();

  // települészóna (A7c): a határon belül a sáv a településsel, a térképen halvány sárga kitöltés
  const zone = await openPage();
  await zone.goto('/?sim=zona&route=0&speed=12&panel=0');
  await zone.waitFor(MAP_READY, 60_000, 'térkép');
  await zone.waitFor(BAND_SHOWN, 90_000, 'zóna-sáv');
  const zoneText = await zone.evaluate(BAND_TEXT);
  check('zóna: a sáv a településsel, dátummal, forrással', /^Rendőrségi mérés .+ területén · .+ · forrás: .+$/.test(zoneText), zoneText);
  zone.close();

  // kapcsoló kikapcsolva: a sáv nem jelenik meg, a vonal sem
  const off = await openPage();
  await off.goto('/?sim=tervezett&route=0&speed=12&panel=0', { tervezett_meresek: false });
  await off.waitFor(MAP_READY, 60_000, 'térkép');
  // a rávezetőtől (itt lenne a sáv) a mérés közepéig figyelve
  let everShown = false;
  let measured = 0;
  for (let i = 0; i < 400 && measured < 12; i++) {
    everShown ||= await off.evaluate(BAND_SHOWN);
    if (await off.evaluate(`!!document.querySelector('.slowdown')`)) measured++;
    await sleep(250);
  }
  check('a kikapcsolt próbán a mérés is lefutott', measured >= 12);
  check('„Tervezett mérések mutatása” ki: nincs sáv', !everShown);
  off.close();

  // --- 2. marketing-képernyőképek (1×, szimulátor-panel nélkül) ---
  if (!CHECK_ONLY) {
    const s = await openPage();
    // a rávezető közepe: a tervezett mérés vonalán, még a szakasz előtt → nagy sáv; a kamera a közelben
    await s.goto('/?sim=tervezett&route=0&speed=1&seek=0.14&panel=0');
    await s.waitFor(MAP_READY, 60_000, 'térkép');
    await s.waitFor(BAND_BIG, 30_000, 'nagy sáv');
    await sleep(4000); // csempék, fények
    await s.shot(`${DATE}-tervezett-meres-sav.png`);
    // a kamera a képernyő közepén (az autó előtt), ne a sáv alatt
    await s.waitFor(
      `[...document.querySelectorAll('.camera-pin')].some((e) => { const r = e.getBoundingClientRect(); return r.top > 330 && r.top < 560; })`,
      60_000,
      'kamera a nézet közepén',
    );
    await s.shot(`${DATE}-fix-kamerak.png`);
    s.close();

    // települészóna: a sáv a településsel, a határ halvány sárga kitöltéssel a térképen
    const z = await openPage();
    await z.goto('/?sim=zona&route=0&speed=1&seek=0.4&panel=0');
    await z.waitFor(MAP_READY, 60_000, 'térkép');
    await z.waitFor(BAND_SHOWN, 30_000, 'zóna-sáv');
    await sleep(4000);
    await z.shot(`${DATE}-telepuleszona.png`);
    z.close();

    // bejelentés-ikonok: kizoomolt, felülnézeti térkép a pálya elején
    const r = await openPage();
    await r.goto('/?sim=jo&route=0&speed=1&seek=0.05&panel=0');
    await r.waitFor(MAP_READY, 60_000, 'térkép');
    await r.waitFor(`${inView('.report-pin')} >= 1`, 60_000, 'bejelentés a nézetben');
    // kizoomolás csípéssel (érintés-emuláció; a követés kikapcsol), hogy több bejelentés is látsszon
    for (let i = 0; i < 2; i++) await r.send('Input.synthesizePinchGesture', { x: 195, y: 380, scaleFactor: 0.35, relativeSpeed: 600, gestureSourceType: 'touch' });
    await r.waitFor(`${inView('.report-pin')} >= 2`, 20_000, 'több bejelentés a nézetben');
    await sleep(3500);
    await r.shot(`${DATE}-terkep-bejelentesekkel.png`);
    r.close();
  }
} finally {
  proc.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} ellenőrzés zöld`);
process.exit(failed ? 1 : 0);
