// A8 – navigáció végigjátszása headless Chrome-mal, iPhone-méretben, a szimulátorban (rögzített Directions-fixtúra,
// élő útvonal-hívás nélkül): keresés → útvonalválasztó → indulás → letérés + újratervezés → szakasz-közeledés →
// mérés közbeni összevont nézet → gyorsabb út ajánlat → érkezés. Ellenőrzések + marketing-PNG-k a docs/screenshots/-ba.
//
//   npm run dev -w @atlagsebesseg/web            # másik terminálban (a Mapbox-token az apps/web/.env-ben)
//   npm run nav-shots -w @atlagsebesseg/web
//   npm run nav-shots -w @atlagsebesseg/web -- --check-only
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeChrome, launchChrome, openPage, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const OUT = join(here, '..', '..', '..', 'docs', 'screenshots');
const DATE = new Date().toISOString().slice(0, 10);
const CHECK_ONLY = process.argv.includes('--check-only');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'HIBA'}  ${name}${detail ? ` – ${detail}` : ''}`);
}

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => `(${q(sel)}?.innerText ?? '').replace(/\\s+/g, ' ').trim()`;
const MAP_READY = `document.querySelector('.mapboxgl-canvas') && document.querySelector('.puck')`;
const click = (p, sel) => p.evaluate(`${q(sel)}.click(); true`);

const chrome = await launchChrome();
const mk = () => openPage({ port: chrome.port, base: BASE, outDir: OUT });
try {
  // ------------------------------------------------------------------
  // 1. végigjátszás gyorsítva: keresés → útvonal → indulás → ... → érkezés
  // ------------------------------------------------------------------
  const p = await mk();
  await p.goto('/?navsim&speed=12&panel=0');
  await p.waitFor(MAP_READY, 60_000, 'térkép');
  await p.waitFor(`document.querySelector('button[aria-label="Úti cél keresése"]')`, 20_000, 'lupa gomb');
  check('a lupa gomb a jobb alsó gombsorban', await p.evaluate(`(() => { const r = ${q('button[aria-label="Úti cél keresése"]')}.getBoundingClientRect(); return r.bottom > innerHeight * 0.7 && r.left > innerWidth * 0.1; })()`));
  const lupa = await p.evaluate(`${q('button[aria-label="Úti cél keresése"]')}.getBoundingClientRect().height`);
  check('a lupa gomb érintési célja ≥ 56 px', lupa >= 56, `${lupa} px`);

  await click(p, 'button[aria-label="Úti cél keresése"]');
  await p.waitFor(q('.search-screen'), 5000, 'kereső');
  await p.evaluate(`${q('.search-field input')}.focus(); true`);
  await p.type('Gy');
  await sleep(600);
  check('2 karakterre nincs keresés (csak a tipp)', (await p.evaluate(`document.querySelectorAll('.search-screen .place-row').length`)) === 0 && /legalább 3/.test(await p.evaluate(text('.search-body'))));
  await p.type('őr');
  await p.waitFor(`document.querySelectorAll('.search-screen .place-row').length >= 2`, 5000, 'találatok');
  const rows = await p.evaluate(`[...document.querySelectorAll('.search-screen .place-row b')].map((e) => e.innerText)`);
  check('gépelés közben találatok', rows[0] === 'Győr', rows.join(', '));
  const rowH = await p.evaluate(`document.querySelector('.search-screen .place-row').getBoundingClientRect().height`);
  check('a találat sora ≥ 56 px', rowH >= 56, `${rowH} px`);

  await click(p, '.search-screen .place-row');
  await p.waitFor(`document.querySelectorAll('.picker .route-opt').length >= 2`, 15_000, 'útvonalválasztó');
  const opts = await p.evaluate(`[...document.querySelectorAll('.route-opt')].map((e) => e.innerText.replace(/\\s+/g, ' '))`);
  check('útvonalválasztó: idő, táv, szakaszellenőrzés, kamera, késés', /perc|ó/.test(opts[0]) && /km/.test(opts[0]) && /Szakaszellenőrzés: 1/.test(opts[0]) && /Kamera: [1-9]/.test(opts[0]) && /dugó/i.test(opts[0]), opts[0]);
  check('az alternatíva is megjelenik', opts.length >= 2, `${opts.length} útvonal`);
  await sleep(1800);
  if (!CHECK_ONLY) await p.shot(`${DATE}-nav-utvonalvalaszto.png`);

  await click(p, '.picker-start');
  await p.waitFor(q('.nav-top'), 10_000, 'felső kártya');
  await p.waitFor(q('.nav-bottom'), 5000, 'alsó sáv');
  const top0 = await p.evaluate(text('.nav-top'));
  check('felső kártya: távolság + út/irány', /\d+(,\d)? ?(m|km)/.test(top0), top0);
  const bottom0 = await p.evaluate(text('.nav-bottom'));
  check('alsó sáv: érkezés, hátralévő idő, táv, Befejezés', /\d{1,2}:\d{2}/.test(bottom0) && /km/.test(bottom0) && /Befejezés/.test(bottom0), bottom0);
  const sign = await p.evaluate(`(() => { const e = ${q('.sign-slot .sign')}; if (!e) return null; const r = e.getBoundingClientRect(); return { txt: e.innerText, left: r.left, bottom: r.bottom }; })()`);
  check('a sebességhatár-tábla a bal alsó sarokban (maxspeed-annotációból)', !!sign && sign.left < 40 && sign.bottom > 600, JSON.stringify(sign));

  // letérés → újratervezés
  await p.waitFor(`${q('.nav-top')}?.dataset.busy === 'true'`, 90_000, 'újratervezés jelzés');
  check('letéréskor „Újratervezés…” jelzés', /Újratervezés/.test(await p.evaluate(text('.nav-top'))));
  await p.waitFor(`${q('.nav-top')} && ${q('.nav-top')}.dataset.busy === 'false'`, 30_000, 'új útvonal átvette');
  check('az új útvonal átvette a helyet', true);

  // gyorsabb út ajánlat (a 2 percenkénti figyelésből)
  await p.waitFor(q('.nav-offer'), 120_000, 'gyorsabb út ajánlat');
  const offer = await p.evaluate(text('.nav-offer'));
  check('felugró ajánlat: „Gyorsabb út: −N perc”', /Gyorsabb út: −\d+ perc/.test(offer) && /Elfogad/.test(offer) && /Elvet/.test(offer), offer);
  await sleep(500); // a megjelenési animáció lecsengése
  const btnH = await p.evaluate(`Math.min(...[...document.querySelectorAll('.nav-offer .btn')].map((b) => b.getBoundingClientRect().height))`);
  check('az Elfogad / Elvet gomb ≥ 56 px', btnH >= 55.9, `${btnH} px`);
  await click(p, '.nav-offer .btn:first-child');
  await sleep(300);
  check('az „Elvet” bezárja az ajánlatot', !(await p.evaluate(`!!${q('.nav-offer')}`)));

  // szakasz közeledése: jelzés a felső kártyán
  await p.waitFor(`${q('.nav-badge')} && /Szakaszellenőrzés/.test(${q('.nav-badge')}.innerText)`, 120_000, 'közeledő szakasz jelzés');
  const badge = await p.evaluate(text('.nav-badge'));
  check('közeledő szakasz: „Szakaszellenőrzés … · max 110”', /^Szakaszellenőrzés \d+(,\d)? (km|m) · max 110$/.test(badge), badge);

  // mérés közben: egysoros sáv a mérőkártya fölött, a felső kártya eltűnik
  await p.waitFor(q('.nav-strip'), 120_000, 'összevont sáv');
  check('mérés közben a navigációs utasítás egysoros sávvá zsugorodik', !(await p.evaluate(`!!${q('.nav-top')}`)));
  const strip = await p.evaluate(`(() => { const s = ${q('.nav-strip')}.getBoundingClientRect(); const c = document.querySelector('.hud .card:not(.nav-bottom)').getBoundingClientRect(); return { h: s.height, above: s.bottom <= c.top + 1 }; })()`);
  check('a sáv egysoros és a mérőkártya fölött van', strip.h <= 60 && strip.above, JSON.stringify(strip));
  await p.waitFor(`${q('.nav-top')} && !${q('.nav-strip')}`, 120_000, 'mérés után vissza a teljes nézet');
  check('mérés után vissza a teljes navigációs nézet', true);

  // érkezés
  await p.waitFor(q('.nav-arrived'), 240_000, 'érkezés');
  check('érkezés: „Megérkeztél”', /Megérkeztél/.test(await p.evaluate(text('.nav-top'))));

  // hang: a bemondott mondatok (szimulátorban a window.__navVoice-ba is kerülnek)
  const voice = await p.evaluate(`window.__navVoice ?? []`);
  const kinds = new Set(voice.map((v) => v.kind));
  check('hang: forduló-utasítások', kinds.has('instruction'), `${voice.filter((v) => v.kind === 'instruction').length} db`);
  check('hang: újratervezés', kinds.has('reroute'));
  check('hang: szakaszellenőrzés közeledése a határral', voice.some((v) => v.kind === 'section' && /Szakaszellenőrzés kezdődik, maximum 110/.test(v.text)), voice.find((v) => v.kind === 'section')?.text);
  check('hang: „Túl gyors”', voice.some((v) => v.kind === 'tooFast'));
  check('hang: gyorsabb út', kinds.has('faster'));

  // befejezés
  await click(p, '.nav-end');
  await sleep(300);
  check('a „Befejezés” kilép a navigációból', !(await p.evaluate(`!!${q('.nav-top')} || !!${q('.nav-bottom')}`)));
  check('nincs kezeletlen JS-kivétel', p.logs.length === 0, p.logs.join(' | '));
  p.close();

  // ------------------------------------------------------------------
  // 2. költségvédelem és beállítások
  // ------------------------------------------------------------------
  const s = await mk();
  await s.goto('/?navsim&speed=12&panel=0');
  await s.waitFor(MAP_READY, 60_000, 'térkép');
  await s.waitFor(`document.querySelector('button[aria-label="Beállítások"]')`, 20_000, 'beállítások gomb');
  await click(s, 'button[aria-label="Beállítások"]');
  await s.waitFor(q('.sheet'), 5000, 'beállítások');
  const sheet = await s.evaluate(text('.sheet'));
  check('Beállítások: Hangos utasítások, Mentett helyek (Haza, Munka), Útvonal-kérések ma', /Hangos utasítások/.test(sheet) && /Haza/.test(sheet) && /Munka/.test(sheet) && /Útvonal-kérések ma/.test(sheet));
  check('a hangos utasítások alapból be vannak', (await s.evaluate(`document.querySelector('[role=switch][aria-label="Hangos utasítások"]').getAttribute('aria-checked')`)) === 'true');
  s.close();

  // ------------------------------------------------------------------
  // 3. marketing-képernyőképek (1×-es lejátszás, szimulátor-panel nélkül)
  // ------------------------------------------------------------------
  if (!CHECK_ONLY) {
    const info = await mk();
    await info.goto('/?navsim&panel=0');
    await info.waitFor(`window.__navSim`, 60_000, 'szimulátor-adat');
    const { windows, length } = await info.evaluate(`window.__navSim`);
    info.close();
    console.log(`  ablakok: ${windows.join(', ')} / ${length}`);

    // navigáció felső kártyával (az 1. ablak eleje, a belvárosból indulás)
    const a = await mk();
    await a.goto('/?navsim&stage=nav&speed=1&at=20&panel=0');
    await a.waitFor(MAP_READY, 60_000, 'térkép');
    await a.waitFor(q('.nav-top'), 30_000, 'felső kártya');
    await sleep(4500);
    await a.shot(`${DATE}-nav-felso-kartya.png`);
    a.close();

    // szakasz-közeledés: a B ablakban a szakasz előtt ~1,5 km-re
    const b = await mk();
    await b.goto(`/?navsim&stage=nav&speed=1&at=${windows[1] + 55}&panel=0`);
    await b.waitFor(MAP_READY, 60_000, 'térkép');
    await b.waitFor(`${q('.nav-badge')} && /Szakaszellenőrzés/.test(${q('.nav-badge')}.innerText)`, 60_000, 'szakasz-jelzés');
    await sleep(4500);
    await b.shot(`${DATE}-nav-szakasz-kozeledes.png`);
    b.close();

    // mérés közbeni összevont nézet: a szakaszon, gyors szakaszban (Túl gyors)
    const m = await mk();
    await m.goto(`/?navsim&stage=nav&speed=1&at=${windows[1] + 95 + 22}&panel=0`);
    await m.waitFor(MAP_READY, 60_000, 'térkép');
    await m.waitFor(q('.nav-strip'), 60_000, 'összevont sáv');
    await sleep(4500);
    await m.shot(`${DATE}-nav-meres-kozben.png`);
    m.close();

    // gyorsabb út ajánlat: 4×-es lejátszás, amíg az ajánlat meg nem jelenik
    const o = await mk();
    await o.goto('/?navsim&stage=nav&speed=4&panel=0');
    await o.waitFor(MAP_READY, 60_000, 'térkép');
    await o.waitFor(q('.nav-offer'), 180_000, 'ajánlat');
    await sleep(1200);
    await o.shot(`${DATE}-nav-gyorsabb-ut.png`);
    o.close();
  }
} finally {
  await closeChrome(chrome);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} ellenőrzés zöld`);
process.exit(failed ? 1 : 0);
