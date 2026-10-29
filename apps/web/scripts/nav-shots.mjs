// A8 – navigáció végigjátszása headless Chrome-mal, iPhone-méretben, a szimulátorban (rögzített Directions-fixtúra,
// élő útvonal-hívás nélkül): keresés → útvonalválasztó → indulás → letérés + újratervezés → szakasz-közeledés →
// mérés közbeni összevont nézet → gyorsabb út ajánlat → érkezés; az alternatíva címkéje és érintése (A8d). Ellenőrzések + marketing-PNG-k a docs/screenshots/-ba.
// AW12: „megéri”-kategóriák (?alt=worth|maybe|not), kapu utáni lehajtó (?alt=aftergate), azonnali újratervezés-hang,
// borostyán kamera-sáv + rezgés, pozíció-jel az alsó harmadban, „Utána” sor, mentett címek chip-sora.
// AW13: kapu utáni (≤ 1 km) lehajtó → azonnali kompakt ajánlat, fogyó csík a kiemelt gomb alatt, „megéri” bemondás a
// lehajtóval, helyhozzáférés: GPS-pill (prompt → kérés, denied → tiltott-lap a böngészőre, granted → semmi), első gesztus.
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
/** A név nélküli manőver teljes Directions-mondata (ez nem kerülhet az „Utána” sorba). */
const SENTENCE = /^(Forduljon|Tartson|Hajtson|Válassza|Menjen|Térjen|Megérkezett)/;

const chrome = await launchChrome();
const mk = () => openPage({ port: chrome.port, base: BASE, outDir: OUT });
try {
  // ------------------------------------------------------------------
  // 1. végigjátszás gyorsítva: keresés → útvonal → indulás → ... → érkezés
  // ------------------------------------------------------------------
  const p = await mk();
  // a fő végigjátszásban a „lehet” kategória: 45 s után marad a régi (a „megéri” elfogadása letérést okozna a szimulátorban)
  await p.goto('/?navsim&speed=12&alt=maybe&panel=0');
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
  check('útvonalválasztó: idő, táv, szakaszellenőrzés, kamera, késés', /perc|ó/.test(opts[0]) && /km/.test(opts[0]) && /Szakaszellenőrzés: 1/.test(opts[0]) && /[1-9]\d* kamera · \d+ ellenőrzött/.test(opts[0]) && /dugó/i.test(opts[0]), opts[0]);
  check('az alternatíva is megjelenik', opts.length >= 2, `${opts.length} útvonal`);
  await sleep(1800);
  if (!CHECK_ONLY) await p.shot(`${DATE}-nav-utvonalvalaszto.png`);

  // A8d: címke az alternatíván; érintésre az lesz a kiválasztott, a kártya átvált
  const checked = `[...document.querySelectorAll('.route-opt')].findIndex((e) => e.getAttribute('aria-checked') === 'true')`;
  await p.waitFor(q('.route-label'), 10_000, 'alternatíva-címke');
  const label0 = await p.evaluate(`(() => { const e = ${q('.route-label')}; const r = e.getBoundingClientRect(); return { txt: e.innerText.trim(), id: e.dataset.routeId, h: r.height, w: r.width }; })()`);
  check('címke az alternatíván: „+N perc” / „−N perc”', /^([+−]\d+ perc|Ugyanannyi idő)$/.test(label0.txt), label0.txt);
  check('a címke érintési célja ≥ 56 px', label0.h >= 56 && label0.w >= 56, `${label0.w}×${label0.h} px`);
  check('egyetlen címke (csak az alternatíván)', (await p.evaluate(`document.querySelectorAll('.route-label').length`)) === opts.length - 1);
  await click(p, '.route-label');
  await p.waitFor(`${checked} === 1`, 3000, 'kiválasztás-váltás');
  const label1 = await p.evaluate(`(() => { const e = ${q('.route-label')}; return { txt: e.innerText.trim(), id: e.dataset.routeId }; })()`);
  check('érintésre az alternatíva lesz a kiválasztott, a kártya átvált', label1.id !== label0.id, `${label0.id} → ${label1.id}`);
  check('a címke a másik útvonalra kerül, ellentétes előjellel', label0.txt === 'Ugyanannyi idő' || label0.txt[0] !== label1.txt[0], `${label0.txt} → ${label1.txt}`);
  await click(p, '.route-opt');
  await p.waitFor(`${checked} === 0`, 3000, 'vissza az ajánlottra');

  await click(p, '.picker-start');
  await p.waitFor(q('.nav-top'), 10_000, 'felső kártya');
  await p.waitFor(q('.nav-bottom'), 5000, 'alsó sáv');
  const top0 = await p.evaluate(text('.nav-top'));
  check('felső kártya: távolság + út/irány', /\d+(,\d)? ?(m|km)/.test(top0), top0);
  const bottom0 = await p.evaluate(text('.nav-bottom'));
  check('alsó sáv: érkezés, hátralévő idő, táv, Befejezés', /\d{1,2}:\d{2}/.test(bottom0) && /km/.test(bottom0) && /Befejezés/.test(bottom0), bottom0);
  // AW12: navigáció közben a pozíció-jel az alsó harmadban (az út előre látszik); az „Utána” sor nem a teljes mondat
  // a kamera fókusza képkockánként közelít (headless Chrome-ban ritka a rAF): a beállást várjuk, legfeljebb 10 s-ig
  const PUCK_Y = `(() => { const r = ${q('.puck')}.getBoundingClientRect(); return (r.top + r.height / 2) / innerHeight; })()`;
  await p.waitFor(`${PUCK_Y} > 0.69`, 10_000, 'pozíció-jel az alsó harmadban').catch(() => undefined);
  const puckY = await p.evaluate(PUCK_Y);
  check('követő kamera: a pozíció-jel a képernyő alsó harmadában', puckY > 0.68, `${(puckY * 100).toFixed(0)}% magasságban`);
  const thenTexts = new Set();
  const sampleThen = async () => {
    const x = await p.evaluate(`${q('.nav-then-text')}?.innerText ?? null`);
    if (x) thenTexts.add(x);
  };
  await sampleThen();
  const sign = await p.evaluate(`(() => { const e = ${q('.sign-slot .sign')}; if (!e) return null; const r = e.getBoundingClientRect(); return { txt: e.innerText, left: r.left, bottom: r.bottom }; })()`);
  check('a sebességhatár-tábla a bal alsó sarokban (maxspeed-annotációból)', !!sign && sign.left < 40 && sign.bottom > 600, JSON.stringify(sign));

  // letérés → újratervezés
  for (let i = 0; i < 20 && !(await p.evaluate(`${q('.nav-top')}?.dataset.busy === 'true'`)); i++) {
    await sampleThen();
    await sleep(400);
  }
  await p.waitFor(`${q('.nav-top')}?.dataset.busy === 'true'`, 90_000, 'újratervezés jelzés');
  check('letéréskor „Újratervezés…” jelzés', /Újratervezés/.test(await p.evaluate(text('.nav-top'))));
  await p.waitFor(`${q('.nav-top')} && ${q('.nav-top')}.dataset.busy === 'false'`, 30_000, 'új útvonal átvette');
  check('az új útvonal átvette a helyet', true);

  // gyorsabb út ajánlat (a 2 percenkénti figyelésből)
  await p.waitFor(q('.nav-offer'), 120_000, 'gyorsabb út ajánlat');
  const offer = await p.evaluate(text('.nav-offer'));
  check('felugró ajánlat (lehet): „Lehet · −3 perc, +5 km” + lehajtó', /^Lehet · −3 perc, \+5 km Lehajtó/.test(offer) && /Elfogad/.test(offer) && /Elvet/.test(offer), offer);
  // elrendezési magasság: a megjelenési animáció (rise, scale 0,985) a getBoundingClientRect-et még összenyomhatja
  const btnH = await p.evaluate(`Math.min(...[...document.querySelectorAll('.nav-offer .btn')].map((b) => b.offsetHeight))`);
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

  // AW12: közeli kamera – a felső kártya borostyán, „Kamera N m · max 130”, egy rezgés; elhaladás után vissza
  await p.waitFor(`${q('.nav-top')}?.dataset.camera === 'true'`, 120_000, 'kamera-közeledés');
  const camTxt = await p.evaluate(text('.nav-camera'));
  check('kamera-közeledés: borostyán felső sáv, „Kamera N m · max 130”', /^Kamera \d+ m · max 130$/.test(camTxt), camTxt);
  // a háttér átmenete (motion-base) alatt pollozunk; 12×-es lejátszásnál a sáv csak ~1 s-ig látszik
  // a cél-színt mérjük (átmenet nélkül): headless Chrome-ban az átmenet képkockái ritkák, a kirajzolt érték lemarad
  const AMBER = `(() => { const e = ${q('.nav-top')}; e.style.transition = 'none'; const c = getComputedStyle(e).backgroundColor; e.style.transition = ''; return c.replace(/\\s/g, '') === 'rgb(255,178,36)'; })()`;
  const amber = await p.waitFor(AMBER, 2000, 'borostyán háttér').then(() => true, () => false);
  check('a felső sáv háttere borostyán (near token)', amber, await p.evaluate(`getComputedStyle(${q('.nav-top')}).backgroundColor`));
  await p.waitFor(`${q('.nav-top')}?.dataset.camera === 'false'`, 30_000, 'kamera után vissza');
  check('elhaladás után a felső sáv visszaáll', true);
  const vib = await p.evaluate(`window.__navVibrate ?? []`);
  // a fő útvonalon valódi (beépített) kamera is lehet: mindegyikre pontosan egy
  check('kameránként egy rezgés', vib.filter((id) => id === 'sim-nav-cam').length === 1 && new Set(vib).size === vib.length, JSON.stringify(vib));

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
  check('hang: gyorsabb út („lehet”: „…, te döntesz”)', voice.some((v) => v.kind === 'faster' && v.text === 'Gyorsabb út, 3 perc, 5 kilométer kerülő, te döntesz'), voice.find((v) => v.kind === 'faster')?.text);
  check('„Utána” sor: utcanév / rövid manőver-szó, nem a teljes mondat', thenTexts.size > 0 && [...thenTexts].every((x) => !SENTENCE.test(x)), [...thenTexts].join(' | '));

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
  check('Beállítások: „Új hely mentése”', /Új hely mentése/.test(sheet));
  s.close();

  // ------------------------------------------------------------------
  // AW12: mentett címek chip-sora, újratervezés-hang, ajánlat-kategóriák, kapu utáni lehajtó
  // ------------------------------------------------------------------
  const info0 = await mk();
  await info0.goto('/?navsim&panel=0');
  await info0.waitFor(`window.__navSim`, 60_000, 'szimulátor-adat');
  const { windows } = await info0.evaluate(`window.__navSim`);
  info0.close();

  const c = await mk();
  await c.goto('/?navsim&speed=12&panel=0');
  await c.waitFor(MAP_READY, 60_000, 'térkép');
  const SAVED = {
    home: { id: 'h', name: 'Budapest', address: 'Magyarország', lat: 47.4979, lon: 19.0402 },
    work: { id: 'w', name: 'Győr', address: 'Győr-Moson-Sopron', lat: 47.6875, lon: 17.6504 },
    others: [
      { id: 'o1', name: 'Gyöngyös', address: 'Heves', lat: 47.7827, lon: 19.9279 },
      { id: 'o2', name: 'Wien', address: 'Österreich', lat: 48.2082, lon: 16.3738 },
    ],
  };
  await c.evaluate(`localStorage.setItem('nav:saved:v1', ${JSON.stringify(JSON.stringify(SAVED))}); location.reload(); true`);
  await sleep(500);
  await c.waitFor(`document.querySelector('button[aria-label="Úti cél keresése"]')`, 60_000, 'lupa gomb');
  await click(c, 'button[aria-label="Úti cél keresése"]');
  await c.waitFor(q('.saved-chips'), 5000, 'chip-sor');
  const chips = await c.evaluate(`(() => {
    const row = ${q('.saved-chips')}.getBoundingClientRect();
    const field = ${q('.search-field')}.getBoundingClientRect();
    const body = ${q('.search-body')}.getBoundingClientRect();
    const place = document.querySelector('.search-body .place-row')?.getBoundingClientRect().height ?? 64;
    const items = [...document.querySelectorAll('.saved-chip')];
    return { labels: items.map((e) => e.innerText.trim()), h: items[0].getBoundingClientRect().height, place, between: row.top >= field.bottom && row.bottom <= body.top + 1 };
  })()`);
  check('kereső: mentett címek chip-sora (Haza, Munka, továbbiak)', chips.labels.join(',') === 'Haza,Munka,Gyöngyös,Wien', chips.labels.join(', '));
  check('a chip-sor a keresőmező és a találatok között, kisebb a találat-soroknál', chips.between && chips.h < chips.place && chips.h <= 40, `${chips.h} px vs. ${chips.place} px`);
  await sleep(600);
  if (!CHECK_ONLY) await c.shot(`${DATE}-nav-kereso-chipek.png`);
  await click(c, '.saved-chip:nth-child(3)');
  await c.waitFor(`${q('.picker')} && /Gyöngyös/.test(${q('.picker')}.innerText)`, 15_000, 'chip → útvonalválasztó');
  check('chipre koppintva a mentett cím a célpont', true);
  c.close();

  // az „Újratervezés” hang a sárga kiírással együtt (a letérés kezdetén), nem az új útvonal megérkezésekor
  const r = await mk();
  await r.goto('/?navsim&stage=nav&speed=1&at=120&alt=maybe&panel=0');
  await r.waitFor(MAP_READY, 60_000, 'térkép');
  await r.waitFor(`${q('.nav-top')}?.dataset.busy === 'true'`, 90_000, 'letérés');
  const atBusy = await r.evaluate(`({ voice: (window.__navVoice ?? []).filter((v) => v.kind === 'reroute').length, spinning: !!document.querySelector('.nav-reroute .spin') })`);
  check('újratervezés: a hang a kiírással együtt szól (a kérés indulása előtt)', atBusy.voice === 1 && !atBusy.spinning, JSON.stringify(atBusy));
  await r.waitFor(`${q('.nav-top')}?.dataset.busy === 'false'`, 30_000, 'új útvonal');
  check('újratervezés: egyszer szól, az új útvonalnál nem ismétli', (await r.evaluate(`(window.__navVoice ?? []).filter((v) => v.kind === 'reroute').length`)) === 1);
  r.close();

  // ajánlat-kategóriák: kártya + bemondás
  for (const [alt, title, said, name] of [
    ['worth', /^Megéri · −7 perc, \+4 km/, /^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$/, 'megeri'],
    ['maybe', /^Lehet · −3 perc, \+5 km/, /^Gyorsabb út, 3 perc, 5 kilométer kerülő, te döntesz$/, 'lehet'],
    ['not', /^Nem éri meg · \+40 km kerülő, −10 perc/, /^Gyorsabb út, de nem éri meg, 40 kilométer kerülő$/, 'nem-eri-meg'],
  ]) {
    const o = await mk();
    await o.goto(`/?navsim&stage=nav&speed=8&alt=${alt}&panel=0`);
    await o.waitFor(MAP_READY, 60_000, 'térkép');
    await o.waitFor(q('.nav-offer'), 120_000, `ajánlat (${alt})`);
    await sleep(700);
    const card = await o.evaluate(`(() => { const e = ${q('.nav-offer')}; return { txt: e.innerText.replace(/\s+/g, ' ').trim(), verdict: e.dataset.verdict, primary: e.querySelector('.btn.primary')?.innerText }; })()`);
    const v = await o.evaluate(`(window.__navVoice ?? []).filter((x) => x.kind === 'faster').map((x) => x.text)`);
    check(`ajánlat „${alt}”: kártya`, title.test(card.txt) && card.verdict === alt, card.txt);
    check(`ajánlat „${alt}”: bemondás`, said.test(v[0] ?? ''), v[0]);
    check(`ajánlat „${alt}”: a kiemelt gomb a 45 s utáni alapértelmezés`, card.primary === (alt === 'worth' ? 'Elfogad' : 'Elvet'), card.primary);
    // AW13: fogyó csík a kiemelt gomb alatt, szám nélkül; csak egy van, és a kiemelt gombban. A beállított (nem a
    // kirajzolt) értéket mérjük: headless Chrome-ban az átmenet képkockái ritkák
    const TIMER = `(() => { const e = ${q('.nav-offer-timer')}; if (!e) return null; const m = new DOMMatrix(e.style.transform); const b = e.closest('.btn').getBoundingClientRect(); const r = e.getBoundingClientRect(); return { scale: m.a, inPrimary: e.closest('.btn').classList.contains('primary'), n: document.querySelectorAll('.nav-offer-timer').length, below: r.top >= b.bottom - 1, h: r.height, txt: e.innerText }; })()`;
    const t1 = await o.evaluate(TIMER);
    // 8×-os lejátszás: legfeljebb 2 s ≈ 16 s szimulált idő (a közeli lehajtó elhagyása előtt)
    await o.waitFor(`(${TIMER})?.scale < ${t1?.scale ?? 0}`, 2000, 'a csík fogy').catch(() => undefined);
    const t2 = await o.evaluate(TIMER);
    check(`ajánlat „${alt}”: fogyó csík a kiemelt gomb alatt, szám nélkül`, !!t1 && t1.inPrimary && t1.n === 1 && t1.below && t1.h <= 4 && t1.txt === '', JSON.stringify(t1));
    check(`ajánlat „${alt}”: a csík fogy`, !!t1 && !!t2 && t2.scale < t1.scale && t1.scale <= 1, `${t1?.scale.toFixed(2)} → ${t2?.scale.toFixed(2)}`);
    if (!CHECK_ONLY) await o.shot(`${DATE}-nav-ajanlat-${name}.png`);
    o.close();
  }

  // AW13: a fogyó csík képe – 2×-es lejátszás, ~12 s-mal az ajánlat után (a csík kb. negyedénél fogyott)
  if (!CHECK_ONLY) {
    const cs = await mk();
    await cs.goto('/?navsim&stage=nav&speed=2&alt=worth&panel=0');
    await cs.waitFor(MAP_READY, 60_000, 'térkép');
    await cs.waitFor(q('.nav-offer-timer'), 180_000, 'ajánlat csíkkal');
    await sleep(6000);
    await cs.shot(`${DATE}-nav-ajanlat-csik.png`);
    cs.close();
  }

  // AW13: kapu utáni (1 km-en belüli) lehajtó: mérés közben azonnal kompakt ajánlat, bemondással
  const g = await mk();
  await g.goto(`/?navsim&stage=nav&speed=6&alt=aftergate&at=${windows[1]}&panel=0`);
  await g.waitFor(MAP_READY, 60_000, 'térkép');
  await g.waitFor(q('.nav-strip'), 120_000, 'mérés');
  await g.waitFor(q('.nav-offer-compact'), 120_000, 'kompakt ajánlat mérés közben');
  const ga = await g.evaluate(`({ strip: !!${q('.nav-strip')}, txt: ${text('.nav-offer')}, exit: ${text('.nav-offer-exit')} })`);
  // a cím és a lehajtó ténylegesen látszik (az innerText a nullára nyomott szöveget is visszaadná)
  const head = await g.evaluate(`(() => { const h = ${q('.nav-offer-compact .nav-offer-head')}.getBoundingClientRect(); const c = ${q('.nav-offer-compact')}.getBoundingClientRect(); return { w: Math.round(h.width), card: Math.round(c.width) }; })()`);
  check('kompakt ajánlat: a cím és a lehajtó látszik (a gombok mellett)', head.w >= 120, `${head.w} / ${head.card} px`);
  const gVoice = await g.evaluate(`(window.__navVoice ?? []).filter((x) => x.kind === 'faster').map((x) => x.text)`);
  check('kapu utáni (1 km-en belüli) lehajtó: mérés közben azonnal kompakt ajánlat', ga.strip && /^Megéri · −7 perc, \+4 km/.test(ga.txt), ga.txt);
  check('kapu utáni lehajtó: bemondás a lehajtó távolságával', gVoice.length === 1 && /^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$/.test(gVoice[0]), gVoice.join(' | '));
  await sleep(600);
  if (!CHECK_ONLY) await g.shot(`${DATE}-nav-ajanlat-kapu-utan.png`);
  check('nincs kezeletlen JS-kivétel (AW12–13-oldalak)', g.logs.length === 0, g.logs.join(' | '));
  g.close();

  // ------------------------------------------------------------------
  // AW13: helyhozzáférés (valódi mód, a Permissions API és a geolocation a lap előtt felülírva)
  // ------------------------------------------------------------------
  const UA_MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
  const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
  /** `state`: a Permissions API válasza; `mode`: a watchPosition – `deny` (azonnali elutasítás), `wait` (nincs válasz), `fix`. */
  const fakeGeo = (state, mode) => `(() => {
    const cfg = (window.__geoFake = { calls: 0 });
    const ps = { state: ${JSON.stringify(state)}, onchange: null, addEventListener() {}, removeEventListener() {} };
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && d.name === 'geolocation' ? Promise.resolve(ps) : query(d));
    navigator.geolocation.watchPosition = (ok, err) => {
      cfg.calls++;
      if (${JSON.stringify(mode)} === 'deny') setTimeout(() => err({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' }), 50);
      if (${JSON.stringify(mode)} === 'fix') setTimeout(() => ok({ coords: { latitude: 47.4979, longitude: 19.0402, accuracy: 8, speed: null, heading: null, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() }), 50);
      return cfg.calls;
    };
    navigator.geolocation.clearWatch = () => {};
  })()`;
  const GPS_PILL = `document.querySelector('.pills .pill')`;
  async function geoPage(state, mode, ua) {
    const pg = await mk();
    await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeGeo(state, mode) });
    if (ua) await pg.send('Emulation.setUserAgentOverride', { userAgent: ua });
    // Mac-en nincs érintőképernyő (különben iPadnek ismerjük fel)
    if (ua === UA_MAC_SAFARI) await pg.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await pg.goto('/');
    // az indítóképernyő „Indulás” gombja után indul az automatikus kérés
    await pg.waitFor(q('.start .btn.primary'), 30_000, 'indítóképernyő');
    await pg.evaluate(`${q('.start .btn.primary')}.click(); true`);
    await pg.waitFor(`${GPS_PILL} && window.__geoFake?.calls >= 1`, 30_000, 'GPS-pill');
    await sleep(400);
    return pg;
  }
  const pill = (pg) => pg.evaluate(`(() => { const e = ${GPS_PILL}; return { tag: e.tagName, txt: e.innerText.trim(), tone: e.dataset.tone, calls: window.__geoFake.calls }; })()`);

  // denied → tiltott-lap a bekapcsolás útjával (Mac Safari, iOS Safari)
  for (const [ua, name, re] of [
    [UA_MAC_SAFARI, 'Mac Safari', /Safari › Beállítások › Webhelyek › Hely[\s\S]*Rendszerbeállítások › Adatvédelem és biztonság › Helymeghatározás/],
    [UA_IPHONE, 'iOS Safari', /Beállítások › Adatvédelem és biztonság › Helymeghatározás[\s\S]*Webhely-beállítások › Hely/],
  ]) {
    const d = await geoPage('denied', 'deny', ua);
    const p0 = await pill(d);
    check(`denied (${name}): a GPS-pill kattintható, „Helyhozzáférés tiltva”`, p0.tag === 'BUTTON' && p0.txt === 'Helyhozzáférés tiltva', JSON.stringify(p0));
    await d.evaluate(`${GPS_PILL}.click(); true`);
    await d.waitFor(q('.geo-help'), 5000, 'tiltott-lap');
    const sheetTxt = await d.evaluate(text('.sheet'));
    check(`denied (${name}): „A helyhozzáférés le van tiltva” + a bekapcsolás útja`, /^A helyhozzáférés le van tiltva/.test(sheetTxt) && re.test(sheetTxt) && /Újrapróbálás/.test(sheetTxt), sheetTxt.slice(0, 160));
    if (!CHECK_ONLY) {
      await sleep(500);
      await d.shot(`${DATE}-hely-tiltva-${name === 'Mac Safari' ? 'mac-safari' : 'ios-safari'}.png`);
    }
    if (ua === UA_IPHONE) {
      const before = (await pill(d)).calls;
      await d.evaluate(`[...document.querySelectorAll('.geo-help .btn')].at(-1).click(); true`);
      await sleep(200);
      check('tiltott-lap: az „Újrapróbálás” újra kér és bezár', (await pill(d)).calls === before + 1 && !(await d.evaluate(`!!${q('.geo-help')}`)));
    }
    d.close();
  }

  // prompt + gesztus nélküli elutasítás (Mac Safari): „koppints”, az első érintés bárhol újra kér; a pill is kér
  const pr = await geoPage('prompt', 'deny', UA_MAC_SAFARI);
  const pr0 = await pill(pr);
  check('prompt (Mac Safari, gesztus nélkül elutasítva): a pill „GPS – koppints az engedélyhez”', pr0.tag === 'BUTTON' && pr0.txt === 'GPS – koppints az engedélyhez', JSON.stringify(pr0));
  await pr.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await sleep(200);
  const pr1 = await pill(pr);
  check('az első érintés bárhol újra kéri a helyet', pr1.calls === pr0.calls + 1, `${pr0.calls} → ${pr1.calls}`);
  await pr.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await sleep(200);
  check('csak az első érintés kér magától', (await pill(pr)).calls === pr1.calls);
  await pr.evaluate(`${GPS_PILL}.click(); true`);
  await sleep(200);
  check('prompt: a GPS-pill koppintása kér (nem nyit lapot)', (await pill(pr)).calls === pr1.calls + 1 && !(await pr.evaluate(`!!${q('.sheet')}`)));
  pr.close();

  // granted: pontosság, a pill nem gomb
  const gr = await geoPage('granted', 'fix');
  await gr.waitFor(`/±/.test(${GPS_PILL}.innerText)`, 10_000, 'pontosság');
  const gr0 = await pill(gr);
  check('granted: a pill a pontosságot mutatja, koppintásra semmi', gr0.tag === 'DIV' && /^GPS ±8 m$/.test(gr0.txt), JSON.stringify(gr0));
  check('nincs kezeletlen JS-kivétel (helyhozzáférés)', gr.logs.length === 0, gr.logs.join(' | '));
  gr.close();

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

    // A8d, AW11: az alternatíva a színes és a visszafogott térképen (útvonalválasztó); sötét rendszer-módban a térkép
    // alkony/éjjel (éjjeli szín, világos kontúr), világosban – nappali órában – nappal (sötét kontúr)
    for (const terkep of ['szines', 'visszafogott']) {
      for (const [mod, suffix] of [['dark', ''], ['light', '-nappal']]) {
        const v = await mk();
        await v.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mod }] });
        await v.goto('/?navsim&stage=picker&speed=1&panel=0', { terkep });
        await v.waitFor(MAP_READY, 60_000, 'térkép');
        await v.waitFor(q('.route-label'), 30_000, 'alternatíva-címke');
        await sleep(4000);
        await v.shot(`${DATE}-nav-alternativa-${terkep}${suffix}.png`);
        v.close();
      }
    }

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

    // közeli kamera: a borostyán felső sáv (a B ablakban, a szakasz után)
    const k = await mk();
    await k.goto(`/?navsim&stage=nav&speed=1&at=${windows[1] + 245}&alt=maybe&panel=0`);
    await k.waitFor(MAP_READY, 60_000, 'térkép');
    await k.waitFor(`${q('.nav-top')}?.dataset.camera === 'true'`, 60_000, 'kamera-közeledés');
    await sleep(2500);
    await k.shot(`${DATE}-nav-kamera-kozel.png`);
    k.close();

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
