// A8 – navigáció végigjátszása headless Chrome-mal, iPhone-méretben, a szimulátorban (rögzített Directions-fixtúra,
// élő útvonal-hívás nélkül): keresés → útvonalválasztó → indulás → letérés + újratervezés → szakasz-közeledés →
// mérés közbeni összevont nézet → gyorsabb út ajánlat → érkezés; az alternatíva címkéje és érintése (A8d). Ellenőrzések + marketing-PNG-k a docs/screenshots/-ba.
// AW12: „megéri”-kategóriák (?alt=worth|maybe|not), kapu utáni lehajtó (?alt=aftergate), azonnali újratervezés-hang,
// borostyán kamera-sáv + rezgés, pozíció-jel az alsó harmadban, „Utána” sor, mentett címek chip-sora.
// AW13: kapu utáni (≤ 1 km) lehajtó → azonnali kompakt ajánlat, fogyó csík a kiemelt gomb alatt, „megéri” bemondás a
// lehajtóval, helyhozzáférés: GPS-pill (prompt → kérés, denied → tiltott-lap a böngészőre, granted → semmi), első gesztus.
// AOS13: a mérés eredménye navigáció közben kompakt, és nem ér a felső kártya alá.
// AW14: van pozíció → a pill koppintása semmit nem nyit, akármit mond a Permissions API.
// AW15: a pill újrakérésére jött PERMISSION_DENIED a tiltott-lapot nyitja (Permissions API nélkül is); nyelvlista
// zászlóval, ábécérendben; a Beállítások a hely-választás után nyitva marad; három térképstílus (a „Világos” mindig
// nappal); a kézi átlagmérés navigáció közben pillé zsugorodik; a kézi eredmény navigáció közben kompakt.
// AW16: a zsugorított kézi kártya a mérőkártya lekicsinyített változata (a kézi mérés accent színében, referencia nélkül), a kézi mérés
// hálózat nélkül, privát; a kereső kerek gombja felül, a jobb szélen; Bejelentés menü: „Átlagmérés eleje / vége”;
// térképstílus-szabály napszakonként (?sunAt=): Világos = nappal, Színes = alkony nappal, éjjel mindkettő éjszakai.
// AOS14: köszöntés az üres nézeten a kereső-gomb alatt („Szia Kristof!” / „Szia!”), köszönés a navigáció indításakor;
// „Még ott van?” – közeledéskor magától nyíló bejelentés-kártya Igen / Nem gombbal, egyszer kérdez.
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
  const lupaBox = await p.evaluate(`(() => { const e = ${q('button[aria-label="Úti cél keresése"]')}; const r = e.getBoundingClientRect(); const s = ${q('button[aria-label="Beállítások"]')}.getBoundingClientRect(); const pills = ${q('.pills')}.getBoundingClientRect(); const gps = ${q('.pills .pill')}.getBoundingClientRect(); return { top: r.top, right: r.right, w: r.width, h: r.height, sw: s.width, sh: s.height, inActions: !!e.closest('.actions'), edge: innerWidth - r.right, overlapsRow: r.top < gps.bottom && r.bottom > gps.top, pillsRight: pills.right, left: r.left, cls: e.className }; })()`);
  check('a kereső kerek gombja felül, a GPS-pill sorában, a JOBB szélre zárva', lupaBox.overlapsRow && lupaBox.top < 100 && lupaBox.edge >= 8 && lupaBox.edge <= 20 && lupaBox.pillsRight <= lupaBox.left, JSON.stringify(lupaBox));
  check('a kereső gombja ugyanaz a kerek stílus, mint az alsó gomboké, és kikerült az alsó gombsorból', Math.abs(lupaBox.w - lupaBox.sw) < 0.5 && Math.abs(lupaBox.h - lupaBox.sh) < 0.5 && /round-btn/.test(lupaBox.cls) && !lupaBox.inActions, JSON.stringify(lupaBox));
  check('a kereső gombjának érintési célja ≥ 56 px', lupaBox.h >= 56, `${lupaBox.h} px`);
  if (!CHECK_ONLY) {
    await sleep(2500);
    await p.shot(`${DATE}-ures-nezet.png`);
  }
  // Bejelentés menü: az „Átlagmérés eleje / vége” a menü alján
  await click(p, 'button[aria-label="Bejelentés"]');
  await p.waitFor(q('.sheet .tiles'), 5000, 'bejelentés-menü');
  const tiles = await p.evaluate(`[...document.querySelectorAll('.sheet .tile')].map((t) => t.innerText.replace(/\\s+/g, ' ').trim())`);
  check('Bejelentés menü: alul „Átlagmérés eleje” és „Átlagmérés vége”, az „Ideiglenes szakasz” megszűnt', tiles.slice(-2).join('|') === 'Átlagmérés eleje|Átlagmérés vége' && tiles.length === 8 && !tiles.some((t) => /Ideiglenes/.test(t)), tiles.join(' | '));
  if (!CHECK_ONLY) {
    await sleep(500);
    await p.shot(`${DATE}-bejelentes-menu.png`);
  }
  await p.evaluate(`${q('.sheet-backdrop')}?.click(); true`);
  await sleep(400);
  await p.evaluate(`document.querySelector('.sheet') && document.querySelector('.sheet .close, .sheet button[aria-label="Bezárás"]')?.click(); true`);
  await sleep(300);

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
  // AOS13: a mérés eredménye navigáció közben egysoros kártya, a teljes felső kártya alatt (nem fedi egymást)
  const done = await p.evaluate(`(() => { const top = ${q('.nav-top')}.getBoundingClientRect(); const c = document.querySelector('.hud .card:not(.nav-bottom)'); if (!c) return null; const r = c.getBoundingClientRect(); return { label: c.getAttribute('aria-label'), compact: c.classList.contains('compact'), h: Math.round(r.height), gap: Math.round(r.top - top.bottom), strip: ${q('.nav-top')}.dataset.strip }; })()`);
  check('mérés után: kompakt eredménykártya, nem ér a felső kártya alá', done?.label === 'Szakasz vége' && done.compact && done.h <= 90 && done.gap >= 12 && done.strip === 'false', JSON.stringify(done));

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
    // AW13: fogyó csík a kiemelt gomb alatt, szám nélkül; csak egy van, és a kiemelt gombban. A beállított (nem a
    // kirajzolt) értéket mérjük: headless Chrome-ban az átmenet képkockái ritkák. AOS13: az első mérés rögtön az ajánlat
    // megjelenésekor – 8×-os lejátszásnál a 400 m-es lehajtót az autó néhány másodperc alatt elhagyja (és az ajánlat eltűnik)
    const TIMER = `(() => { const e = ${q('.nav-offer-timer')}; if (!e) return null; const m = new DOMMatrix(e.style.transform); const b = e.closest('.btn').getBoundingClientRect(); const r = e.getBoundingClientRect(); return { scale: m.a, inPrimary: e.closest('.btn').classList.contains('primary'), n: document.querySelectorAll('.nav-offer-timer').length, below: r.top >= b.bottom - 1, h: r.height, txt: e.innerText }; })()`;
    const t1 = await o.evaluate(TIMER);
    await sleep(700);
    const card = await o.evaluate(`(() => { const e = ${q('.nav-offer')}; return { txt: e.innerText.replace(/\s+/g, ' ').trim(), verdict: e.dataset.verdict, primary: e.querySelector('.btn.primary')?.innerText }; })()`);
    const v = await o.evaluate(`(window.__navVoice ?? []).filter((x) => x.kind === 'faster').map((x) => x.text)`);
    check(`ajánlat „${alt}”: kártya`, title.test(card.txt) && card.verdict === alt, card.txt);
    check(`ajánlat „${alt}”: bemondás`, said.test(v[0] ?? ''), v[0]);
    check(`ajánlat „${alt}”: a kiemelt gomb a 45 s utáni alapértelmezés`, card.primary === (alt === 'worth' ? 'Elfogad' : 'Elvet'), card.primary);
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
  const ga = await g.evaluate(`({ strip: !!${q('.nav-strip')}, l1: ${text('.nav-offer-compact .nav-offer-title')}, l2: ${text('.nav-offer-compact .nav-offer-exit')} })`);
  // a cím és a lehajtó ténylegesen látszik (az innerText a nullára nyomott szöveget is visszaadná)
  const head = await g.evaluate(`(() => { const h = ${q('.nav-offer-compact .nav-offer-head')}.getBoundingClientRect(); const c = ${q('.nav-offer-compact')}.getBoundingClientRect(); return { w: Math.round(h.width), card: Math.round(c.width) }; })()`);
  check('kompakt ajánlat: a cím és a lehajtó látszik (a gombok mellett)', head.w >= 120, `${head.w} / ${head.card} px`);
  const gVoice = await g.evaluate(`(window.__navVoice ?? []).filter((x) => x.kind === 'faster').map((x) => x.text)`);
  check('kapu utáni (1 km-en belüli) lehajtó: mérés közben azonnal kompakt ajánlat', ga.strip && !!ga.l1, `${ga.l1} / ${ga.l2}`);
  // kétsoros: „Kijárat 56” / „2,1 km · −7 perc”; 390 px-en egyik sor sem vágódik le
  check('kompakt ajánlat kétsoros: lehajtó neve / „2,1 km · −7 perc”', !/Megéri|Lehajtó/.test(ga.l1) && /^\d+,\d km · −7 perc$/.test(ga.l2), `${ga.l1} / ${ga.l2}`);
  const clip = await g.evaluate(
    `[...document.querySelectorAll('.nav-offer-compact .nav-offer-head > *')].map((e) => ({ t: e.textContent, sw: e.scrollWidth, cw: e.clientWidth }))`,
  );
  check('kompakt ajánlat: 390 px-en sincs levágott sor', clip.length === 2 && clip.every((c) => c.sw <= c.cw), clip.map((c) => `${c.t} ${c.sw}/${c.cw}`).join(' | '));
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
  /**
   * `state`: a Permissions API válasza (`none`: a lekérdezés hibát ad, mint ahol az API nincs); `mode`: a watchPosition –
   * `deny` (azonnali elutasítás), `nosignal` (POSITION_UNAVAILABLE), `wait` (nincs válasz), `fix`.
   */
  const fakeGeo = (state, mode) => `(() => {
    const cfg = (window.__geoFake = { calls: 0 });
    const ps = { state: ${JSON.stringify(state)}, onchange: null, addEventListener() {}, removeEventListener() {} };
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) =>
      d && d.name === 'geolocation' ? (ps.state === 'none' ? Promise.reject(new TypeError('geolocation')) : Promise.resolve(ps)) : query(d);
    navigator.geolocation.watchPosition = (ok, err) => {
      cfg.calls++;
      if (${JSON.stringify(mode)} === 'deny') setTimeout(() => err({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' }), 50);
      if (${JSON.stringify(mode)} === 'nosignal') setTimeout(() => err({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'unavailable' }), 50);
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
  check('az automatikus és az első-érintéses kérés elutasítása nem nyit lapot', !(await pr.evaluate(`!!${q('.sheet')}`)));
  await pr.evaluate(`${GPS_PILL}.click(); true`);
  await sleep(200);
  // AW15: a pill kérésére jött elutasítás (PERMISSION_DENIED) a tiltott-lapot nyitja
  check('prompt: a GPS-pill koppintása kér, az elutasításra a tiltott-lap nyílik (AW15)', (await pill(pr)).calls === pr1.calls + 1 && (await pr.evaluate(`!!${q('.geo-help')}`)));
  pr.close();

  // granted: pontosság, a pill nem gomb
  const gr = await geoPage('granted', 'fix');
  await gr.waitFor(`/±/.test(${GPS_PILL}.innerText)`, 10_000, 'pontosság');
  const gr0 = await pill(gr);
  check('granted: a pill a pontosságot mutatja, nem gomb', gr0.tag === 'DIV' && /^GPS ±8 m$/.test(gr0.txt), JSON.stringify(gr0));
  await gr.evaluate(`${GPS_PILL}.click(); true`);
  await sleep(300);
  check('granted: koppintásra nem nyílik lap és nincs újrakérés', !(await gr.evaluate(`!!${q('.sheet')}`)) && (await pill(gr)).calls === gr0.calls);
  check('nincs kezeletlen JS-kivétel (helyhozzáférés)', gr.logs.length === 0, gr.logs.join(' | '));
  gr.close();

  // AW14 (élesben, iPhone Safari): zöld pill ±8 m-rel, a Permissions API mégis „denied” → a pozíció nyer, nincs lap
  for (const [state, name] of [['denied', 'API „denied”'], ['none', 'nincs Permissions API']]) {
    const ip = await geoPage(state, 'fix', UA_IPHONE);
    await ip.waitFor(`/±/.test(${GPS_PILL}.innerText)`, 10_000, 'pontosság');
    const ip0 = await pill(ip);
    await ip.evaluate(`${GPS_PILL}.click(); true`);
    await sleep(300);
    const sheet = await ip.evaluate(`!!${q('.sheet')}`);
    check(`iOS Safari, ${name}, van pozíció: zöld pill ±8 m, koppintásra nincs tiltott-lap`, ip0.tag === 'DIV' && ip0.tone === 'jo' && /^GPS ±8 m$/.test(ip0.txt) && !sheet, JSON.stringify({ ...ip0, sheet }));
    ip.close();
  }
  // iOS Safari, nincs Permissions API, nincs pozíció (elutasítva): a pill kér (nem a lapot nyitja a „denied”-re) – AW15: a
  // kérésre jött PERMISSION_DENIED (1) után a tiltott-lap nyílik
  const nx = await geoPage('none', 'deny', UA_IPHONE);
  const nx0 = await pill(nx);
  const nxSheet0 = await nx.evaluate(`!!${q('.sheet')}`);
  await nx.evaluate(`${GPS_PILL}.click(); true`);
  await nx.waitFor(q('.geo-help'), 3000, 'tiltott-lap').catch(() => undefined);
  const nx1 = await pill(nx);
  check(
    'AW15: iOS Safari, nincs Permissions API: a pill kér, a PERMISSION_DENIED válaszra a tiltott-lap nyílik',
    nx0.tag === 'BUTTON' && !nxSheet0 && nx1.calls === nx0.calls + 1 && (await nx.evaluate(`!!${q('.geo-help')}`)),
    `${JSON.stringify(nx0)} → ${nx1.calls}`,
  );
  check('nincs kezeletlen JS-kivétel (AW14)', nx.logs.length === 0, nx.logs.join(' | '));
  nx.close();
  // más hiba (nincs jel) a pill kérésére: nincs tiltott-lap
  const ns = await geoPage('none', 'nosignal', UA_IPHONE);
  const ns0 = await pill(ns);
  await ns.evaluate(`${GPS_PILL}.click(); true`);
  await sleep(400);
  check('AW15: a pill kérésére „nincs jel” hiba: nincs tiltott-lap', (await pill(ns)).calls === ns0.calls + 1 && !(await ns.evaluate(`!!${q('.sheet')}`)));
  ns.close();

  // ------------------------------------------------------------------
  // AW15: nyelvlista, visszatérés a Beállításokba, három térképstílus, kézi pill, kompakt kézi eredmény
  // ------------------------------------------------------------------
  const st = await mk();
  await st.goto('/?navsim&panel=0');
  await st.waitFor(MAP_READY, 60_000, 'térkép');
  await st.waitFor(`document.querySelector('button[aria-label="Beállítások"]')`, 20_000, 'beállítások gomb');
  await click(st, 'button[aria-label="Beállítások"]');
  await st.waitFor(q('.sheet'), 5000, 'beállítások');
  const langs = await st.evaluate(`[...document.querySelectorAll('.sheet select option')].map((o) => o.textContent)`);
  check(
    'nyelvlista: „Automatikus” legfelül, utána zászló + saját név ábécérendben',
    /^Automatikus/.test(langs[0]) && langs.slice(1).join('|') === '🇨🇿 Čeština|🇩🇪 Deutsch|🇬🇧 English|🇭🇺 Magyar|🇵🇱 Polski|🇸🇰 Slovenčina',
    langs.join(', '),
  );
  const looks = await st.evaluate(`(() => {
    const seg = ${q('.sheet .segmented[aria-label="Térkép"]')};
    const row = seg.closest('.list-row').getBoundingClientRect();
    const btns = [...seg.querySelectorAll('button')];
    return { labels: btns.map((b) => b.textContent), inside: btns.every((b) => b.getBoundingClientRect().right <= row.right + 0.5 && b.scrollWidth <= b.clientWidth) };
  })()`);
  check('Térkép: Világos / Színes / Visszafogott (ebben a sorrendben), 390 px-en sem lóg ki', looks.labels.join('|') === 'Világos|Színes|Visszafogott' && looks.inside, JSON.stringify(looks));
  await st.evaluate(`${q('.sheet .segmented[aria-label="Térkép"]')}.scrollIntoView({ block: 'center' }); true`);
  await sleep(500);
  if (!CHECK_ONLY) await st.shot(`${DATE}-beallitasok-nyelv-terkep.png`);
  // Haza beállítása: a kereső a lap fölött nyílik, választás után a lap nyitva, ugyanott
  const HOME_BTN = `[...document.querySelectorAll('.sheet .list-row')].find((r) => /^Haza/.test(r.innerText)).querySelector('.mini-btn')`;
  await st.evaluate(`${HOME_BTN}.scrollIntoView({ block: 'center' }); true`);
  await sleep(300);
  const scroll0 = await st.evaluate(`${q('.sheet')}.scrollTop`);
  await st.evaluate(`${HOME_BTN}.click(); true`);
  await st.waitFor(q('.search-screen'), 5000, 'kereső');
  check('Haza beállítása: a kereső a Beállítások fölött nyílik (a lap alatta nyitva)', await st.evaluate(`!!${q('.sheet')} && +getComputedStyle(${q('.search-screen')}).zIndex > +getComputedStyle(${q('.sheet')}).zIndex`));
  await st.evaluate(`${q('.search-field input')}.focus(); true`);
  await st.type('Győr');
  await st.waitFor(`document.querySelectorAll('.search-screen .place-row').length >= 1`, 5000, 'találat');
  await click(st, '.search-screen .place-row');
  await sleep(400);
  const back = await st.evaluate(`({ search: !!${q('.search-screen')}, sheet: !!${q('.sheet')}, scroll: ${q('.sheet')}?.scrollTop, home: [...document.querySelectorAll('.sheet .list-row')].find((r) => /^Haza/.test(r.innerText))?.innerText.replace(/\\s+/g, ' ') })`);
  check('választás után a Beállítások nyitva marad, ugyanott (görgetés is), a Haza beállítva', !back.search && back.sheet && Math.abs(back.scroll - scroll0) <= 1 && /^Haza Győr/.test(back.home), JSON.stringify({ ...back, scroll0 }));
  await st.evaluate(`[...document.querySelectorAll('.sheet .mini-btn')].find((b) => /Új hely/.test(b.innerText)).click(); true`);
  await st.waitFor(q('.search-screen'), 5000, 'kereső (új hely)');
  await st.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);
  check('Escape a lap fölötti keresőben csak a keresőt zárja', await st.evaluate(`!${q('.search-screen')} && !!${q('.sheet')}`));
  check('nincs kezeletlen JS-kivétel (AW15 Beállítások)', st.logs.length === 0, st.logs.join(' | '));
  st.close();

  // AW16: három térképstílus ugyanarról a helyről (navigáció, a belváros), nappal / napnyugtakor / éjjel (?sunAt), sötét
  // rendszer-módban: a készülék módja sehol nem számít
  const SUN = { nappal: '2026-06-21T10:00:00Z', alkony: '2026-06-21T18:45:00Z', ejjel: '2026-06-21T23:30:00Z' };
  const looked = {};
  for (const terkep of ['vilagos', 'szines', 'visszafogott']) {
    for (const [napszak, sunAt] of Object.entries(SUN)) {
      const v = await mk();
      await v.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await v.goto(`/?navsim&stage=nav&speed=1&at=20&panel=0&sunAt=${sunAt}`, { terkep });
      await v.waitFor(MAP_READY, 60_000, 'térkép');
      await v.waitFor(q('.nav-top'), 30_000, 'felső kártya');
      looked[`${terkep}/${napszak}`] = await v.evaluate(`({ theme: ${q('.mapboxgl-map')}.dataset.theme, light: ${q('.mapboxgl-map')}.dataset.lightPreset, look: document.documentElement.dataset.look })`);
      if (!CHECK_ONLY && napszak !== 'alkony') {
        await sleep(4500);
        await v.shot(`${DATE}-terkep-${terkep}-${napszak === 'nappal' ? 'nappal' : 'ejjel'}.png`);
      }
      v.close();
    }
  }
  const L = (k) => looked[k].light;
  check('Világos: nappal day, napnyugtakor dusk, éjjel night', L('vilagos/nappal') === 'day' && L('vilagos/alkony') === 'dusk' && L('vilagos/ejjel') === 'night', JSON.stringify(looked));
  check('Színes: nappal dusk (alkonyi fény), napnyugtakor dusk, éjjel night', L('szines/nappal') === 'dusk' && L('szines/alkony') === 'dusk' && L('szines/ejjel') === 'night', JSON.stringify(looked));
  check('Visszafogott: napszak szerint (nappal day), monochrome téma', L('visszafogott/nappal') === 'day' && L('visszafogott/ejjel') === 'night' && looked['visszafogott/nappal'].theme === 'monochrome', JSON.stringify(looked));
  check('Világos / Színes: a színes (default) téma; sötét rendszer-módban is ugyanez', looked['vilagos/nappal'].theme === 'default' && looked['szines/nappal'].theme === 'default');
  check('erősebb üveg csak a nappali fényű Világos térképen', looked['vilagos/nappal'].look === 'vilagos' && looked['vilagos/ejjel'].look === 'normal' && looked['szines/nappal'].look === 'normal', JSON.stringify(looked));

  // kézi átlagmérés navigáció nélkül: a nagy kártya marad
  const kn = await mk();
  await kn.goto('/?navsim&panel=0');
  await kn.waitFor(MAP_READY, 60_000, 'térkép');
  await kn.waitFor(q('button[aria-label="Kézi átlagmérés indítása"]'), 20_000, 'stopper');
  await click(kn, 'button[aria-label="Kézi átlagmérés indítása"]');
  await sleep(6500);
  check('navigáció nélkül a kézi mérés nagy kártyája marad (nincs zsugorított kártya)', await kn.evaluate(`!!${q('.hud .card[aria-label="Kézi átlagmérés"] .btn.danger')} && !${q('.manual-mini')}`));
  kn.close();

  // AW16: navigáció közben 5 s után (vagy közeli manővernél) a zsugorított kártya a jobb oldalon: nagy átlag státusz-színnel,
  // „km/h átlag”, idő; bökésre a teljes kártya, újabb bökésre zsugorított; a kézi mérés privát (nincs hálózati hívás)
  const MANUAL_CARD = q('.hud .card[aria-label="Kézi átlagmérés"]');
  const kp = await mk();
  await kp.goto('/?navsim&stage=nav&speed=1&at=20&panel=0');
  await kp.waitFor(MAP_READY, 60_000, 'térkép');
  await kp.waitFor(q('.nav-top'), 30_000, 'felső kártya');
  await kp.waitFor(q('button[aria-label="Kézi átlagmérés indítása"]'), 10_000, 'stopper');
  // hálózat nélkül: a kapu-küldés (reports) soha nem hívódik, a fetch-et megfigyeljük, és a hálózatot kikapcsoljuk
  await kp.evaluate(`window.__reportCalls = []; const f = window.fetch; window.fetch = (...a) => { const u = String(a[0]?.url ?? a[0]); if (/reports/.test(u)) window.__reportCalls.push(u); return f(...a); }; true`);
  await kp.send('Network.enable');
  await kp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await click(kp, 'button[aria-label="Kézi átlagmérés indítása"]');
  await sleep(300);
  const k0 = await kp.evaluate(`({ card: !!${MANUAL_CARD}, chip: ${MANUAL_CARD}?.querySelector('.chip')?.innerText.trim(), mini: !!${q('.manual-mini')}, retry: /Újra/.test(document.body.innerText) })`);
  check('kézi mérés navigáció közben: induláskor a teljes kártya „Kézi átlagmérés” címmel', k0.card && k0.chip === 'Kézi átlagmérés' && !k0.mini, JSON.stringify(k0));
  await kp.waitFor(q('.manual-mini'), 25_000, 'zsugorított kártya');
  const k1 = await kp.evaluate(`(() => { const e = ${q('.manual-mini')}; const r = e.getBoundingClientRect(); const b = e.querySelector('b'); return { txt: e.innerText.replace(/\\s+/g, ' ').trim(), tone: e.dataset.tone, accent: (() => { const i = document.createElement('i'); i.dataset.tone = 'kezi'; i.style.color = 'var(--tone)'; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; })(), right: r.right, left: r.left, w: innerWidth, h: r.height, bigPx: parseFloat(getComputedStyle(b).fontSize), bigColor: getComputedStyle(b).color, stop: !!document.querySelector('.hud .card[aria-label="Kézi átlagmérés"] .btn.danger, .manual-mini .btn'), top: !!${q('.nav-top')}, bottom: !!${q('.nav-bottom')} }; })()`);
  check('zsugorított kártya: nagy átlag, „km/h átlag”, idő; Leállítás nélkül, a jobb oldalon', /^\d+ km\/h átlag \d+:\d{2}$/.test(k1.txt) && !k1.stop && k1.left > k1.w * 0.3 && k1.right > k1.w * 0.6 && k1.bigPx >= 36 && k1.h >= 70, JSON.stringify(k1));
  check('a zsugorított kártya átlag-száma a kézi mérés accent színében, nem státusz-színben', k1.tone === 'kezi' && k1.bigColor === k1.accent, JSON.stringify(k1));
  check('a zsugorított kártya alatt a navigáció teljes: felső kártya + alsó sáv', k1.top && k1.bottom, JSON.stringify(k1));
  check('a kézi mérés privát: hálózat nélkül is fut, nincs kapu-küldés (reports), nincs „Újra” gomb', (await kp.evaluate(`window.__reportCalls.length`)) === 0 && !(await kp.evaluate(`/Újra/.test(document.body.innerText)`)));
  await sleep(300);
  if (!CHECK_ONLY) await kp.shot(`${DATE}-nav-kezi-mini.png`);
  await click(kp, '.manual-mini');
  await sleep(300);
  check('bökésre a teljes kártya nyílik (Leállítással)', await kp.evaluate(`!!${MANUAL_CARD}?.querySelector('.btn.danger') && !${q('.manual-mini')}`));
  await kp.evaluate(`${MANUAL_CARD}.querySelector('.hero').click(); true`);
  await sleep(300);
  check('újabb bökésre visszamegy zsugorított kártyává', await kp.evaluate(`!${MANUAL_CARD} && !!${q('.manual-mini')}`));
  await click(kp, '.manual-mini');
  await kp.waitFor(q('.manual-mini'), 25_000, 'magától vissza').catch(() => undefined);
  check('kinyitva 5 s után (vagy a navigáció helyigényére) magától visszamegy zsugorított kártyává', await kp.evaluate(`!!${q('.manual-mini')}`));
  // leállítás: a kézi eredmény navigáció közben egy sor, a felső kártya alatt
  await click(kp, '.manual-mini');
  await sleep(300);
  await kp.evaluate(`${MANUAL_CARD}.querySelector('.btn.danger').click(); true`);
  await kp.waitFor(q('.hud .card[aria-label="Kézi átlagmérés eredménye"]'), 5000, 'kézi eredmény');
  await sleep(500);
  const kr = await kp.evaluate(`(() => { const c = ${q('.hud .card[aria-label="Kézi átlagmérés eredménye"]')}; const r = c.getBoundingClientRect(); const top = document.querySelector('.nav-top'); return { compact: c.classList.contains('compact'), h: Math.round(r.height), txt: c.innerText.replace(/\\s+/g, ' ').trim(), gap: top ? Math.round(r.top - top.getBoundingClientRect().bottom) : null, retry: /Újra/.test(c.innerText) }; })()`);
  check('kézi eredmény navigáció közben: kompakt egy sor (átlag, táv · idő, Kész), nem ér a felső kártya alá', kr.compact && kr.h <= 90 && /^\d+ km\/h átlag .+ · \d+:\d{2} Kész$/.test(kr.txt) && kr.gap !== null && kr.gap >= 12 && !kr.retry, JSON.stringify(kr));
  if (!CHECK_ONLY) await kp.shot(`${DATE}-nav-kezi-eredmeny.png`);
  check('a kézi eredmény után is nincs kapu-küldés', (await kp.evaluate(`window.__reportCalls.length`)) === 0);
  check('nincs kezeletlen JS-kivétel (AW15/AW16 kézi mérés)', kp.logs.length === 0, kp.logs.join(' | '));
  kp.close();

  // ------------------------------------------------------------------
  // AOS14: köszöntés, köszönés a navigáció indításakor, „Még ott van?”
  // ------------------------------------------------------------------
  const gk = await mk();
  await gk.goto('/?navsim&panel=0', { megszolitas: 'Kristof' });
  await gk.waitFor(MAP_READY, 60_000, 'térkép');
  await gk.waitFor(q('.greeting'), 20_000, 'köszöntés');
  const grt = await gk.evaluate(`(() => { const e = ${q('.greeting')}; const r = e.getBoundingClientRect(); const s = ${q('button[aria-label="Úti cél keresése"]')}.getBoundingClientRect(); return { txt: e.innerText.trim(), top: r.top, left: r.left, bottom: r.bottom, sBottom: s.bottom, h: innerHeight }; })()`);
  check('köszöntés kitöltött megszólítással: „Szia Kristof!”, a kereső-gomb sora alatt, balra – nem a térkép közepén', grt.txt === 'Szia Kristof!' && grt.top >= grt.sBottom && grt.left <= 20 && grt.bottom < grt.h * 0.3, JSON.stringify(grt));
  if (!CHECK_ONLY) {
    await sleep(2500);
    await gk.shot(`${DATE}-koszontes.png`);
  }
  gk.close();
  const gn = await mk();
  await gn.goto('/?navsim&panel=0');
  await gn.waitFor(q('.greeting'), 60_000, 'köszöntés név nélkül');
  check('köszöntés üres megszólítással: „Szia!”', (await gn.evaluate(text('.greeting'))) === 'Szia!');
  gn.close();
  const gvo = await mk();
  await gvo.goto('/?navsim&stage=nav&speed=1&at=20&panel=0', { megszolitas: 'Kristof' });
  await gvo.waitFor(q('.nav-top'), 60_000, 'navigáció');
  await sleep(500);
  const gvoices = await gvo.evaluate(`(window.__navVoice ?? []).map((v) => v.text)`);
  check('navigáció indításakor köszönés: „Szia Kristof, indulhatunk!” (az indulási utasítás előtt)', gvoices[0] === 'Szia Kristof, indulhatunk!', gvoices.slice(0, 3).join(' | '));
  check('navigáció közben nincs köszöntő felirat', !(await gvo.evaluate(`!!${q('.greeting')}`)));
  gvo.close();
  const rpg = await mk();
  await rpg.goto('/?sim=jo&speed=4&panel=0');
  await rpg.waitFor(MAP_READY, 60_000, 'térkép');
  await rpg.waitFor(q('.report-card[data-prompt]'), 90_000, '„Még ott van?” kártya');
  const rpr = await rpg.evaluate(`(() => { const c = ${q('.report-card[data-prompt]')}; return { q: c.querySelector('.report-card-question')?.innerText.trim(), btns: [...c.querySelectorAll('.btn')].map((b) => b.innerText.trim()), title: c.querySelector('.report-card-title')?.innerText.trim(), h: Math.min(...[...c.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect().height)) }; })()`);
  check('közeledéskor magától nyíló kártya: „Még ott van?”, Igen / Nem (≥ 56 px)', rpr.q === 'Még ott van?' && rpr.btns.join('|') === 'Igen|Nem' && rpr.h >= 56, JSON.stringify(rpr));
  if (!CHECK_ONLY) await rpg.shot(`${DATE}-meg-ott-van.png`);
  const rpFirst = rpr.title;
  await rpg.evaluate(`${q('.report-card[data-prompt] .btn')}.click(); true`);
  await sleep(400);
  check('„Igen”: köszönő toast, a kártya bezárul', /megerősítve/.test(await rpg.evaluate(text('.toast'))) && !(await rpg.evaluate(`!!${q('.report-card[data-prompt]')}`)));
  // a következő kérdés már egy másik bejelentésre szól (ugyanarra nem kérdez újra)
  await rpg.waitFor(q('.report-card[data-prompt]'), 90_000, 'következő kérdés').catch(() => undefined);
  const rpNext = await rpg.evaluate(`${q('.report-card[data-prompt] .report-card-title')}?.innerText.trim() ?? null`);
  check('egyszer kérdez: a következő kérdés másik bejelentésre szól', rpNext !== null && rpNext !== rpFirst, `${rpFirst} → ${rpNext}`);
  check('nincs kezeletlen JS-kivétel (AOS14)', rpg.logs.length === 0 && gk.logs.length === 0, [...rpg.logs, ...gk.logs].join(' | '));
  rpg.close();

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

    // A8d, AW11: az alternatíva a színes és a visszafogott térképen (útvonalválasztó); éjjel éjjeli szín + világos kontúr,
    // nappal (Színes: alkonyi fény, Visszafogott: nappali fény) a napszak szerint (?sunAt, AW16)
    for (const terkep of ['szines', 'visszafogott']) {
      for (const [sunAt, suffix] of [[SUN.ejjel, ''], [SUN.nappal, '-nappal']]) {
        const v = await mk();
        await v.goto(`/?navsim&stage=picker&speed=1&panel=0&sunAt=${sunAt}`, { terkep });
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
} catch (e) {
  // a closeChrome ENOTEMPTY-je különben elnyelné a valódi kivételt
  check(`kivétel: ${e?.message ?? e}`, false);
} finally {
  await closeChrome(chrome).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} ellenőrzés zöld`);
process.exit(failed ? 1 : 0);
