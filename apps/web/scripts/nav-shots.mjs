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
// közeledő bejelentés: EGY kártya a kamera-figyelmeztetés helyén, 50 m-rel előtte helyben „Még ott van? Igen / Nem”,
// az elhaladás után még 10 s-ig;
// a menüben egy kapu-tétel („Átlagmérés eleje” → „vége”).
// AW18: „Leggyorsabb” a legkisebb időn (?fasterAlt), a címke a kerekített percekből („−1 perc”); dugó mód (?traffic): „+N perc
// dugó” az alsó sávban + hang, „Dugóba kerültél?” kártya, Igen → „Dugó” bejelentés a térképen + közösségi minta; újratervezés-
// hiba (?rerouteFail): visszaszámlálás, koppintásra azonnali próba; Bejelentés menü: Dugó / Beállt a kapu-tétel sorában.
// AW19: krúzing (?cruise): cél nélkül is út a naplóban, „Krúzing · …” sor a köszöntés alatt; a rekord számai (km,
// kanyarok, szakaszmérés, minták H3-cellával) az IndexedDB-ből; Napló lap (statisztika, lista, részlet térképpel, törlés).
// AW20: hőtérkép (?heatSeed: mesterséges, több utas adat): a réteg megléte, a mód-váltó (Gyakoriság / Átlagsebesség), a zoom-
// függő összevonás (res 10 → 8), a Beállítások új sorai (Hőtérkép ki / saját / közösségi, adatmegosztás alapból ki), a személyes
// hőtérkép a krúzing-út után (IndexedDB `heat`), az út sebesség szerint színezve a napló-részleten.
//
//   npm run dev -w @atlagsebesseg/web            # másik terminálban (a Mapbox-token az apps/web/.env-ben)
//   npm run nav-shots -w @atlagsebesseg/web
//   npm run nav-shots -w @atlagsebesseg/web -- --check-only
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startWatchdog } from './chrome-guard.mjs';
import { closeChrome, launchChrome, openPage, sleep, VIEW_H } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const OUT = join(here, '..', '..', '..', 'docs', 'screenshots');
const DATE = new Date().toISOString().slice(0, 10);
const CHECK_ONLY = process.argv.includes('--check-only');

const results = [];
const T0 = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'HIBA'} ${String(Math.round((Date.now() - T0) / 1000)).padStart(4)}s ${name}${detail ? ` – ${detail}` : ''}`);
}

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => `(${q(sel)}?.innerText ?? '').replace(/\\s+/g, ' ').trim()`;
const MAP_READY = `document.querySelector('.mapboxgl-canvas') && document.querySelector('.puck')`;
const click = (p, sel) => p.evaluate(`${q(sel)}.click(); true`);
/** A név nélküli manőver teljes Directions-mondata (ez nem kerülhet az „Utána” sorba). */
const SENTENCE = /^(Forduljon|Tartson|Hajtson|Válassza|Menjen|Térjen|Megérkezett)/;

// AW20: egy Chrome, egy lap, az ellenőrzések sorban (a cdp.mjs nem enged egyszerre két nyitott lapot).
// Térkép: `blank` = üres helyi stílus (alapértelmezett a térképet nem mérő ellenőrzéseknél); `real` = valódi stílus 2D-ben, DPR 1
// (címke-elhelyezés, térképstílus); `photo` = az éles megjelenés, DPR 3. Képkészítő (teljes) módban a képet adó lapok `photo`-k.
const REAL = CHECK_ONLY ? 'real' : 'photo';
const SHOT = CHECK_ONLY ? 'blank' : 'photo';
// AW20: a szimulátor-óra a minták időbélyege (a session és az időzítői – újratervezés 5/10/20/30 s, 45 s elfogadás, 2 perces
// lekérés, 2 perces dugó-ablak – ezt olvassák), a `speed` csak a lejátszás ütemét adja; a kiírt értékek szimulált másodpercek.
// Ellenőrző módban a képet nem adó, állapot-alapú blokkok gyorsabban futnak; a valós várakozást (sleep) a szorzóval osztjuk.
const fast = (n, x) => (CHECK_ONLY ? n * x : n);
// AOS18-javítás: teljes (képkészítő) mód csak leállított szimulátorokkal (CLAUDE.md › Szimulátor-szabály): három futó szimulátor mellett a memória elfogy, a Chrome CDP-időtúllépéssel áll meg
if (!CHECK_ONLY) {
  const booted = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted'], { encoding: 'utf8', timeout: 30_000 }).split('\n').filter((l) => l.includes('(Booted)'));
  if (booted.length) {
    console.error(`HIBA: fut szimulátor, a teljes mód nem indul:\n${booted.join('\n')}`);
    process.exit(1);
  }
}
startWatchdog(30, 'nav-shots'); // kemény időkorlát: a teljes futás ~16 perc; lejáratkor a Chrome leáll és a szkript kilép
const chrome = await launchChrome({ photo: !CHECK_ONLY });
const mk = (map = 'blank') => openPage({ port: chrome.port, base: BASE, outDir: OUT, map });
try {
  // ------------------------------------------------------------------
  // 1. végigjátszás gyorsítva: keresés → útvonal → indulás → ... → érkezés
  // ------------------------------------------------------------------
  const p = await mk(REAL);
  // a fő végigjátszásban a „lehet” kategória: 45 s után marad a régi (a „megéri” elfogadása letérést okozna a szimulátorban)
  await p.goto(`/?navsim&speed=${fast(12, 3)}&alt=maybe&panel=0`);
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
  // AOS14 javítás: az „Átlagmérés eleje / vége” egy tétel (elküldés előtt „eleje”)
  check('Bejelentés menü: alul egy kapu-tétel („Átlagmérés eleje”), az „Ideiglenes szakasz” megszűnt', tiles.at(-1) === 'Átlagmérés eleje' && tiles.length === 9 && !tiles.some((t) => /Ideiglenes/.test(t)), tiles.join(' | '));
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
  // AW17: a címke a saját szakasz legtávolabbi pontja mellett (fölé / alá / balra / jobbra), a választó-kártya fölött
  const LABEL_POS = `(() => { const e = ${q('.route-label-bubble')}; const r = e.getBoundingClientRect(); const pk = ${q('.picker')}.getBoundingClientRect(); return { side: ${q('.route-label')}.dataset.side, above: r.bottom <= pk.top + 1, inX: r.left >= 0 && r.right <= innerWidth, l: Math.round(r.left), r: Math.round(r.right), w: innerWidth }; })()`;
  await p.waitFor(`(${LABEL_POS}).inX`, 5000, 'címke a végleges helyén').catch(() => undefined);
  const pos0 = await p.evaluate(LABEL_POS);
  check('AW17: a címke oldala kiszámolt (fölé / alá / balra / jobbra), a képernyőn és a választó-kártya fölött', ['above', 'below', 'left', 'right'].includes(pos0.side) && pos0.above && pos0.inX, JSON.stringify(pos0));
  await click(p, '.route-label');
  await p.waitFor(`${checked} === 1`, 3000, 'kiválasztás-váltás');
  const label1 = await p.evaluate(`(() => { const e = ${q('.route-label')}; return { txt: e.innerText.trim(), id: e.dataset.routeId }; })()`);
  check('érintésre az alternatíva lesz a kiválasztott, a kártya átvált', label1.id !== label0.id, `${label0.id} → ${label1.id}`);
  check('a címke a másik útvonalra kerül, ellentétes előjellel', label0.txt === 'Ugyanannyi idő' || label0.txt[0] !== label1.txt[0], `${label0.txt} → ${label1.txt}`);
  await p.waitFor(`(${LABEL_POS}).inX`, 5000, 'címke a végleges helyén').catch(() => undefined);
  const pos1 = await p.evaluate(LABEL_POS);
  check('AW17: a másik alternatíván is kiszámolt helyen, a választó-kártya fölött', ['above', 'below', 'left', 'right'].includes(pos1.side) && pos1.above && pos1.inX, JSON.stringify(pos1));
  if (!CHECK_ONLY) await p.shot(`${DATE}-nav-cimke-gyor-kivalasztva.png`);
  await click(p, '.route-opt');
  await p.waitFor(`${checked} === 0`, 3000, 'vissza az ajánlottra');
  if (!CHECK_ONLY) {
    await sleep(600);
    await p.shot(`${DATE}-nav-cimke-m19-kivalasztva.png`);
  }

  await click(p, '.picker-start');
  await p.waitFor(q('.nav-top'), 10_000, 'felső kártya');
  await p.waitFor(q('.nav-bottom'), 5000, 'alsó sáv');
  const top0 = await p.evaluate(text('.nav-top'));
  check('felső kártya: távolság + út/irány', /\d+(,\d)? ?(m|km)/.test(top0), top0);
  const bottom0 = await p.evaluate(text('.nav-bottom'));
  check('alsó sáv: érkezés, hátralévő idő, táv, Befejezés', /\d{1,2}:\d{2}/.test(bottom0) && /km/.test(bottom0) && /Befejezés/.test(bottom0), bottom0);
  // AW17: az alsó sáv mindig a képernyő alján (a HUD utolsó eleme), mérésen kívül a pillanatnyi sebességgel
  const BOTTOM = `(() => { const b = ${q('.nav-bottom')}; if (!b) return null; const r = b.getBoundingClientRect(); const c = document.querySelector('.hud > .card:not(.nav-bottom)'); const cr = c?.getBoundingClientRect(); return { last: b === ${q('.hud')}.lastElementChild, gap: Math.round(innerHeight - r.bottom), speed: !!b.querySelector('.nav-bottom-speed'), cardAbove: cr ? cr.bottom <= r.top + 1 : null, card: c?.getAttribute('aria-label') ?? null, compact: c?.classList.contains('compact') ?? null }; })()`;
  const b0 = await p.evaluate(BOTTOM);
  check('AW17: az alsó sáv a képernyő alján, sebességgel (mérésen kívül)', b0.last && b0.gap <= 40 && b0.speed, JSON.stringify(b0));
  // AW12: navigáció közben a pozíció-jel az alsó harmadban (az út előre látszik); az „Utána” sor nem a teljes mondat
  // a kamera fókusza képkockánként közelít (headless Chrome-ban ritka a rAF): a beállást várjuk, legfeljebb 10 s-ig
  const PUCK_Y = `(() => { const r = ${q('.puck')}.getBoundingClientRect(); return (r.top + r.height / 2) / innerHeight; })()`;
  await p.waitFor(`${PUCK_Y} > 0.69`, 10_000, 'pozíció-jel az alsó harmadban').catch(() => undefined);
  const puckY = await p.evaluate(PUCK_Y);
  check('követő kamera: a pozíció-jel a képernyő alsó harmadában', puckY > 0.68, `${(puckY * 100).toFixed(0)}% magasságban`);
  const thenTexts = new Set();
  // AW17: az „Utána” sor csak 5 km-en belüli következő manővernél; a km/h piros, ha a bal alsó tábla fölött van
  const thenSamples = [];
  const speedSamples = [];
  const sampleThen = async () => {
    const x = await p.evaluate(
      `({ then: ${q('.nav-then-text')}?.innerText ?? null, dist: ${q('.nav-top:not([data-strip=true]) .nav-dist')}?.innerText ?? null, speed: ${q('.nav-bottom-speed')}?.firstChild?.textContent ?? null, over: ${q('.nav-bottom-speed')}?.dataset.over ?? null, sign: ${q('.sign-slot .sign')}?.innerText ?? null })`,
    );
    if (x.then) thenTexts.add(x.then);
    if (x.dist) thenSamples.push(x);
    if (x.speed !== null && x.sign) speedSamples.push(x);
  };
  await sampleThen();
  const sign = await p.evaluate(`(() => { const e = ${q('.sign-slot .sign')}; if (!e) return null; const r = e.getBoundingClientRect(); return { txt: e.innerText, left: r.left, bottom: r.bottom }; })()`);
  check('a sebességhatár-tábla a bal alsó sarokban (maxspeed-annotációból)', !!sign && sign.left < 40 && sign.bottom > VIEW_H * 0.6, JSON.stringify(sign));

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
  // (AW17: a közeledés kártyája az alsó sáv fölött már a mérés előtt sávvá zsugoríthatja a lépést – a mérőkártyát várjuk)
  await p.waitFor(`${q('.nav-strip')} && document.querySelector('.hud > .card[aria-label="Mérés"]')`, 120_000, 'összevont sáv');
  check('mérés közben a navigációs utasítás egysoros sávvá zsugorodik', !(await p.evaluate(`!!${q('.nav-top')}`)));
  const strip = await p.evaluate(`(() => { const s = ${q('.nav-strip')}.getBoundingClientRect(); const c = document.querySelector('.hud .card:not(.nav-bottom)').getBoundingClientRect(); return { h: s.height, above: s.bottom <= c.top + 1 }; })()`);
  check('a sáv egysoros és a mérőkártya fölött van', strip.h <= 60 && strip.above, JSON.stringify(strip));
  // AW17: mérés közben is az alsó sáv a képernyő alján, a mérőkártya fölötte; a sávban nincs sebesség (a „most” mutatja)
  await p.waitFor(`document.querySelector('.hud > .card[aria-label="Mérés"]')`, 30_000, 'mérőkártya').catch(() => undefined);
  const bm = await p.evaluate(BOTTOM);
  check('AW17: mérés közben az alsó sáv legalul, a mérőkártya fölötte, a sávban nincs sebesség', bm.last && bm.gap <= 40 && !bm.speed && bm.cardAbove === true && bm.card === 'Mérés', JSON.stringify(bm));
  check('AW17: mérés közben a „most” a mérőkártyán', /most/.test(await p.evaluate(text('.hud > .card[aria-label="Mérés"]'))));
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
  const km = (d) => (/km/.test(d) ? parseFloat(d.replace(',', '.')) * 1000 : parseFloat(d));
  const badThen = thenSamples.filter((x) => x.then && km(x.dist) > 5000);
  check('AW17: „Utána” sor csak 5 km-en belüli következő manővernél', thenSamples.some((x) => x.then) && badThen.length === 0, `${thenSamples.length} minta; hibás: ${JSON.stringify(badThen.slice(0, 3))}`);
  const badSpeed = speedSamples.filter((x) => (x.over === 'true') !== Number(x.speed) > Number(x.sign));
  check('AW17: az alsó sáv km/h-ja pontosan akkor piros, ha a bal alsó tábla fölött van', speedSamples.length > 0 && badSpeed.length === 0, `${speedSamples.length} minta, ebből piros ${speedSamples.filter((x) => x.over === 'true').length}; hibás: ${JSON.stringify(badSpeed.slice(0, 3))}`);

  // befejezés
  await click(p, '.nav-end');
  await sleep(300);
  check('a „Befejezés” kilép a navigációból', !(await p.evaluate(`!!${q('.nav-top')} || !!${q('.nav-bottom')}`)));
  check('nincs kezeletlen JS-kivétel', p.logs.length === 0, p.logs.join(' | '));
  await p.close();

  // ------------------------------------------------------------------
  // 2. költségvédelem és beállítások
  // ------------------------------------------------------------------
  const s = await mk(SHOT);
  await s.goto('/?navsim&speed=12&panel=0');
  await s.waitFor(MAP_READY, 60_000, 'térkép');
  await s.waitFor(`document.querySelector('button[aria-label="Beállítások"]')`, 20_000, 'beállítások gomb');
  await click(s, 'button[aria-label="Beállítások"]');
  await s.waitFor(q('.sheet'), 5000, 'beállítások');
  const sheet = await s.evaluate(text('.sheet'));
  check('Beállítások: Hangos utasítások, Mentett helyek (Haza, Munka), Útvonal-kérések ma', /Hangos utasítások/.test(sheet) && /Haza/.test(sheet) && /Munka/.test(sheet) && /Útvonal-kérések ma/.test(sheet));
  check('a hangos utasítások alapból be vannak', (await s.evaluate(`document.querySelector('[role=switch][aria-label="Hangos utasítások"]').getAttribute('aria-checked')`)) === 'true');
  check('Beállítások: „Új hely mentése”', /Új hely mentése/.test(sheet));
  // AW17: nincs külön „Hang (hangos utasítások)” sor; a hang elérhetősége zárójelben a leírás végén
  const vh = await s.evaluate(`${q('.hint[data-voice]')}?.innerText ?? ''`);
  check('AW17: Beállítások – nincs külön „Hang” sor, a hang-info zárójelben a „Hangos utasítások” leírásában', !/Hang \(hangos utasítások\)/.test(sheet) && /^Fordulók, .*\(.+\)$/.test(vh), vh);
  if (!CHECK_ONLY) {
    await s.evaluate(`${q('.hint[data-voice]')}.scrollIntoView({ block: 'center' }); true`);
    await sleep(400);
    await s.shot(`${DATE}-beallitasok-hangos-utasitasok.png`);
  }
  await s.close();

  // ------------------------------------------------------------------
  // AW12: mentett címek chip-sora, újratervezés-hang, ajánlat-kategóriák, kapu utáni lehajtó
  // ------------------------------------------------------------------
  const info0 = await mk(SHOT);
  await info0.goto('/?navsim&panel=0');
  await info0.waitFor(`window.__navSim`, 60_000, 'szimulátor-adat');
  const { windows } = await info0.evaluate(`window.__navSim`);
  await info0.close();

  const c = await mk(SHOT);
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
  await c.close();

  // az „Újratervezés” hang a sárga kiírással együtt (a letérés kezdetén), nem az új útvonal megérkezésekor
  const r = await mk(SHOT);
  await r.goto(`/?navsim&stage=nav&speed=${fast(1, 4)}&at=120&alt=maybe&panel=0`);
  await r.waitFor(MAP_READY, 60_000, 'térkép');
  await r.waitFor(`${q('.nav-top')}?.dataset.busy === 'true'`, 90_000, 'letérés');
  const atBusy = await r.evaluate(`({ voice: (window.__navVoice ?? []).filter((v) => v.kind === 'reroute').length, spinning: !!document.querySelector('.nav-reroute .spin') })`);
  check('újratervezés: a hang a kiírással együtt szól (a kérés indulása előtt)', atBusy.voice === 1 && !atBusy.spinning, JSON.stringify(atBusy));
  await r.waitFor(`${q('.nav-top')}?.dataset.busy === 'false'`, 30_000, 'új útvonal');
  check('újratervezés: egyszer szól, az új útvonalnál nem ismétli', (await r.evaluate(`(window.__navVoice ?? []).filter((v) => v.kind === 'reroute').length`)) === 1);
  await r.close();

  // ajánlat-kategóriák: kártya + bemondás
  for (const [alt, title, said, name] of [
    ['worth', /^Megéri · −7 perc, \+4 km/, /^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$/, 'megeri'],
    ['maybe', /^Lehet · −3 perc, \+5 km/, /^Gyorsabb út, 3 perc, 5 kilométer kerülő, te döntesz$/, 'lehet'],
    ['not', /^Nem éri meg · \+40 km kerülő, −10 perc/, /^Gyorsabb út, de nem éri meg, 40 kilométer kerülő$/, 'nem-eri-meg'],
  ]) {
    const o = await mk(SHOT);
    const O_SPEED = fast(8, 2);
    await o.goto(`/?navsim&stage=nav&speed=${O_SPEED}&alt=${alt}&panel=0`);
    await o.waitFor(MAP_READY, 60_000, 'térkép');
    await o.waitFor(q('.nav-offer'), 120_000, `ajánlat (${alt})`);
    // AW13: fogyó csík a kiemelt gomb alatt, szám nélkül; csak egy van, és a kiemelt gombban. A beállított (nem a
    // kirajzolt) értéket mérjük: headless Chrome-ban az átmenet képkockái ritkák. AOS13: az első mérés rögtön az ajánlat
    // megjelenésekor – 8×-os lejátszásnál a 400 m-es lehajtót az autó néhány másodperc alatt elhagyja (és az ajánlat eltűnik)
    const TIMER = `(() => { const e = ${q('.nav-offer-timer')}; if (!e) return null; const m = new DOMMatrix(e.style.transform); const b = e.closest('.btn').getBoundingClientRect(); const r = e.getBoundingClientRect(); return { scale: m.a, inPrimary: e.closest('.btn').classList.contains('primary'), n: document.querySelectorAll('.nav-offer-timer').length, below: r.top >= b.bottom - 1, h: r.height, txt: e.innerText }; })()`;
    const t1 = await o.evaluate(TIMER);
    await sleep((700 * 8) / O_SPEED);
    const card = await o.evaluate(`(() => { const e = ${q('.nav-offer')}; return { txt: e.innerText.replace(/\s+/g, ' ').trim(), verdict: e.dataset.verdict, primary: e.querySelector('.btn.primary')?.innerText }; })()`);
    const v = await o.evaluate(`(window.__navVoice ?? []).filter((x) => x.kind === 'faster').map((x) => x.text)`);
    check(`ajánlat „${alt}”: kártya`, title.test(card.txt) && card.verdict === alt, card.txt);
    check(`ajánlat „${alt}”: bemondás`, said.test(v[0] ?? ''), v[0]);
    check(`ajánlat „${alt}”: a kiemelt gomb a 45 s utáni alapértelmezés`, card.primary === (alt === 'worth' ? 'Elfogad' : 'Elvet'), card.primary);
    // 8×-os lejátszás: legfeljebb 2 s ≈ 16 s szimulált idő (a közeli lehajtó elhagyása előtt)
    await o.waitFor(`(${TIMER})?.scale < ${t1?.scale ?? 0}`, (2000 * 8) / O_SPEED, 'a csík fogy').catch(() => undefined);
    const t2 = await o.evaluate(TIMER);
    check(`ajánlat „${alt}”: fogyó csík a kiemelt gomb alatt, szám nélkül`, !!t1 && t1.inPrimary && t1.n === 1 && t1.below && t1.h <= 4 && t1.txt === '', JSON.stringify(t1));
    check(`ajánlat „${alt}”: a csík fogy`, !!t1 && !!t2 && t2.scale < t1.scale && t1.scale <= 1, `${t1?.scale.toFixed(2)} → ${t2?.scale.toFixed(2)}`);
    // a csík értéke a kép ELŐTT (teljes módban a kép alatt már megtörténhet az automatikus váltás)
    const preShot = await o.evaluate(`(${TIMER})?.scale ?? null`);
    if (!CHECK_ONLY) await o.shot(`${DATE}-nav-ajanlat-${name}.png`);
    if (alt === 'worth') {
      // AW17: 500 m-en belül a „Megéri” magától elfogad (a 45 s kivárása nélkül), külön 500 m-es bemondás nélkül
      // (a szimulátor a fő vonalon halad tovább, ezért a váltás után újratervez – a váltás pillanatát pollozzuk)
      let lastScale = preShot;
      let switched = null;
      for (let i = 0; i < 400 && !switched; i++) {
        const st = await o.evaluate(`({ route: window.__navRouteId, scale: (${TIMER})?.scale ?? null })`);
        if (/^sim-fast-worth/.test(st.route ?? '')) switched = st.route;
        else if (st.scale !== null) lastScale = st.scale;
        await sleep(50);
      }
      const sw = await o.evaluate(`({ said500: (window.__navVoice ?? []).some((x) => x.text === 'Gyorsabb út, lehajtó 500 méternél'), offer: !!${q('.nav-offer')} })`);
      check('AW17: „Megéri” – a lehajtó előtt 500 m-en belül magától átvált (a 45 s lejárta előtt)', !!switched && !sw.offer && lastScale !== null && lastScale > 0.05, `${switched}, ${JSON.stringify(sw)}, csík utoljára ${lastScale?.toFixed(2)}`);
      check('AW17: auto-váltáskor nincs „lehajtó 500 méternél” ismétlés', !sw.said500);
    } else if (alt === 'maybe') {
      // „Lehet”: nincs auto-váltás – a lehajtó elhagyásáig a régi útvonal marad
      await o.waitFor(`!${q('.nav-offer')}`, 60_000, 'a „lehet” ajánlat eltűnik').catch(() => undefined);
      const route = await o.evaluate(`window.__navRouteId`);
      check('AW17: „Lehet” – nincs automatikus váltás', !/^sim-fast/.test(route ?? ''), route);
    }
    await o.close();
  }

  // AW13: a fogyó csík képe – 2×-es lejátszás, ~12 s-mal az ajánlat után (a csík kb. negyedénél fogyott)
  if (!CHECK_ONLY) {
    const cs = await mk(SHOT);
    await cs.goto('/?navsim&stage=nav&speed=2&alt=worth&panel=0');
    await cs.waitFor(MAP_READY, 60_000, 'térkép');
    await cs.waitFor(q('.nav-offer-timer'), 180_000, 'ajánlat csíkkal');
    await sleep(6000);
    await cs.shot(`${DATE}-nav-ajanlat-csik.png`);
    await cs.close();
  }

  // AW13: kapu utáni (1 km-en belüli) lehajtó: mérés közben azonnal kompakt ajánlat, bemondással
  const g = await mk(SHOT);
  await g.goto(`/?navsim&stage=nav&speed=${fast(6, 2)}&alt=aftergate&at=${windows[1]}&panel=0`);
  await g.waitFor(MAP_READY, 60_000, 'térkép');
  await g.waitFor(q('.nav-strip'), 120_000, 'mérés');
  await g.waitFor(q('.nav-offer-compact'), 120_000, 'kompakt ajánlat mérés közben');
  const ga = await g.evaluate(`({ strip: !!${q('.nav-strip')}, l1: ${text('.nav-offer-compact .nav-offer-title')} })`);
  const head = await g.evaluate(`(() => { const h = ${q('.nav-offer-compact .nav-offer-head')}.getBoundingClientRect(); const c = ${q('.nav-offer-compact')}.getBoundingClientRect(); return { w: Math.round(h.width), card: Math.round(c.width) }; })()`);
  check('kompakt ajánlat: a szöveg látszik (a gombok mellett)', head.w >= 120, `${head.w} / ${head.card} px`);
  const gVoice = await g.evaluate(`(window.__navVoice ?? []).filter((x) => x.kind === 'faster').map((x) => x.text)`);
  check('kapu utáni (1 km-en belüli) lehajtó: mérés közben azonnal kompakt ajánlat', ga.strip && !!ga.l1, ga.l1);
  // AW17: „Kijárat 56 · 2,5 km · −7 perc gyorsabb”; 390 px-en sem vágódik le (tördelhető)
  check('AW17: kompakt ajánlat: „Kijárat 56 · N,N km · −7 perc gyorsabb”', /^Kijárat 56 · \d+,\d km · −7 perc gyorsabb$/.test(ga.l1), ga.l1);
  const clip = await g.evaluate(`(() => { const e = ${q('.nav-offer-compact .nav-offer-title')}; return { sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight }; })()`);
  check('kompakt ajánlat: 390 px-en sincs levágott szöveg', clip.sw <= clip.cw && clip.sh <= clip.ch + 1, JSON.stringify(clip));
  // AW17: mérés + ajánlat – a mérőkártya egysoros, az ajánlat fölötte, az alsó sáv legalul
  const LAYOUT = `(() => { const c = document.querySelector('.hud > .card[aria-label="Mérés"]'); const b = ${q('.nav-bottom')}; const o = ${q('.nav-offer')}; if (!c || !b) return null; const cr = c.getBoundingClientRect(); const br = b.getBoundingClientRect(); return { compact: c.classList.contains('compact'), h: Math.round(c.offsetHeight), cardAboveBottom: cr.bottom <= br.top + 1, offerAbove: o ? o.getBoundingClientRect().bottom <= cr.top + 1 : null, bottomLast: b === ${q('.hud')}.lastElementChild, speed: !!b.querySelector('.nav-bottom-speed') }; })()`;
  const lay = await g.evaluate(LAYOUT);
  check('AW17: mérés + ajánlat – a mérőkártya egysoros, az ajánlat fölötte, az alsó sáv legalul (sebesség nélkül)', lay?.compact === true && lay.h <= 110 && lay.cardAboveBottom && lay.offerAbove === true && lay.bottomLast && !lay.speed, JSON.stringify(lay));
  check('kapu utáni lehajtó: bemondás a lehajtó távolságával', gVoice.length === 1 && /^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$/.test(gVoice[0]), gVoice.join(' | '));
  await sleep(600);
  // AW17-javítás: egysoros kártyánál nincs külön „Lassíts” sáv – a max érték és a státusz-szín a kártyán
  const cb = await g.evaluate(`({ bar: !!document.querySelector('.slowdown'), max: document.querySelector('.meter-compact-max')?.innerText ?? null, color: document.querySelector('.meter-compact-max') ? getComputedStyle(document.querySelector('.meter-compact-max')).color : null, avgColor: getComputedStyle(document.querySelector('.meter-compact .compact-speed')).color, status: document.querySelector('.hud > .card[aria-label="Mérés"]')?.dataset.tone })`);
  check('AW17-javítás: egysoros kártyánál nincs „Lassíts” sáv; „max X” a kártyán a státusz színében', !cb.bar && /^max \d+$/.test(cb.max ?? '') && cb.color === cb.avgColor && ['lassits', 'tul_gyors'].includes(cb.status), JSON.stringify(cb));
  if (!CHECK_ONLY) await g.shot(`${DATE}-nav-meres-ajanlat.png`);
  // az ajánlat eltűnése után (Elvet – vagy, ha közben 500 m-en belülre ért, az auto-váltás) a mérőkártya visszanő
  await g.evaluate(`${q('.nav-offer-compact .btn')}?.click(); true`);
  await g.waitFor(`!${q('.nav-offer')}`, 5000, 'ajánlat eltűnt');
  await sleep(400);
  const lay2 = await g.evaluate(LAYOUT);
  check('AW17: az ajánlat eltűnése után a mérőkártya visszanő', lay2?.compact === false && lay2.h > 150 && lay2.cardAboveBottom && lay2.bottomLast, JSON.stringify(lay2));
  // a sáv a teljes kártyával visszajön (1,5 s-os hiszterézissel)
  const barBack = await g.waitFor(`document.querySelector('.slowdown')?.dataset.show === 'true'`, 8000, 'sáv vissza').then(() => true, () => false);
  check('AW17-javítás: az ajánlat eltűnése után a „Lassíts” sáv a teljes kártyával visszajön', barBack, await g.evaluate(`document.querySelector('.slowdown')?.innerText ?? null`));
  check('nincs kezeletlen JS-kivétel (AW12–13-oldalak)', g.logs.length === 0, g.logs.join(' | '));
  await g.close();

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
    const pg = await mk(SHOT);
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
    await d.close();
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
  // AOS15-javítás: a lapra pollozva várunk (a fix 200 ms terhelt gépen kevés volt – a teljes futásban egyszer piros lett)
  await pr.waitFor(`window.__geoFake.calls === ${pr1.calls + 1} && !!${q('.geo-help')}`, 5000, 'tiltott-lap (pill)').catch(() => undefined);
  // AW15: a pill kérésére jött elutasítás (PERMISSION_DENIED) a tiltott-lapot nyitja
  check('prompt: a GPS-pill koppintása kér, az elutasításra a tiltott-lap nyílik (AW15)', (await pill(pr)).calls === pr1.calls + 1 && (await pr.evaluate(`!!${q('.geo-help')}`)));
  await pr.close();

  // granted: pontosság, a pill nem gomb
  const gr = await geoPage('granted', 'fix');
  await gr.waitFor(`/±/.test(${GPS_PILL}.innerText)`, 10_000, 'pontosság');
  const gr0 = await pill(gr);
  check('granted: a pill a pontosságot mutatja, nem gomb', gr0.tag === 'DIV' && /^GPS ±8 m$/.test(gr0.txt), JSON.stringify(gr0));
  await gr.evaluate(`${GPS_PILL}.click(); true`);
  await sleep(300);
  check('granted: koppintásra nem nyílik lap és nincs újrakérés', !(await gr.evaluate(`!!${q('.sheet')}`)) && (await pill(gr)).calls === gr0.calls);
  check('nincs kezeletlen JS-kivétel (helyhozzáférés)', gr.logs.length === 0, gr.logs.join(' | '));
  await gr.close();

  // AW14 (élesben, iPhone Safari): zöld pill ±8 m-rel, a Permissions API mégis „denied” → a pozíció nyer, nincs lap
  for (const [state, name] of [['denied', 'API „denied”'], ['none', 'nincs Permissions API']]) {
    const ip = await geoPage(state, 'fix', UA_IPHONE);
    await ip.waitFor(`/±/.test(${GPS_PILL}.innerText)`, 10_000, 'pontosság');
    const ip0 = await pill(ip);
    await ip.evaluate(`${GPS_PILL}.click(); true`);
    await sleep(300);
    const sheet = await ip.evaluate(`!!${q('.sheet')}`);
    check(`iOS Safari, ${name}, van pozíció: zöld pill ±8 m, koppintásra nincs tiltott-lap`, ip0.tag === 'DIV' && ip0.tone === 'jo' && /^GPS ±8 m$/.test(ip0.txt) && !sheet, JSON.stringify({ ...ip0, sheet }));
    await ip.close();
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
  await nx.close();
  // más hiba (nincs jel) a pill kérésére: nincs tiltott-lap
  const ns = await geoPage('none', 'nosignal', UA_IPHONE);
  const ns0 = await pill(ns);
  await ns.evaluate(`${GPS_PILL}.click(); true`);
  await sleep(400);
  check('AW15: a pill kérésére „nincs jel” hiba: nincs tiltott-lap', (await pill(ns)).calls === ns0.calls + 1 && !(await ns.evaluate(`!!${q('.sheet')}`)));
  await ns.close();

  // ------------------------------------------------------------------
  // AW15: nyelvlista, visszatérés a Beállításokba, három térképstílus, kézi pill, kompakt kézi eredmény
  // ------------------------------------------------------------------
  const st = await mk(SHOT);
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
  await st.close();

  // AW16: három térképstílus ugyanarról a helyről (navigáció, a belváros), nappal / napnyugtakor / éjjel (?sunAt), sötét
  // rendszer-módban: a készülék módja sehol nem számít
  const SUN = { nappal: '2026-06-21T10:00:00Z', alkony: '2026-06-21T18:45:00Z', ejjel: '2026-06-21T23:30:00Z' };
  const looked = {};
  for (const terkep of ['vilagos', 'szines', 'visszafogott']) {
    for (const [napszak, sunAt] of Object.entries(SUN)) {
      const v = await mk(REAL);
      await v.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await v.goto(`/?navsim&stage=nav&speed=1&at=20&panel=0&sunAt=${sunAt}`, { terkep });
      await v.waitFor(MAP_READY, 60_000, 'térkép');
      await v.waitFor(q('.nav-top'), 30_000, 'felső kártya');
      looked[`${terkep}/${napszak}`] = await v.evaluate(`({ theme: ${q('.mapboxgl-map')}.dataset.theme, light: ${q('.mapboxgl-map')}.dataset.lightPreset, look: document.documentElement.dataset.look })`);
      if (!CHECK_ONLY && napszak !== 'alkony') {
        await sleep(4500);
        await v.shot(`${DATE}-terkep-${terkep}-${napszak === 'nappal' ? 'nappal' : 'ejjel'}.png`);
      }
      await v.close();
    }
  }
  const L = (k) => looked[k].light;
  check('Világos: nappal day, napnyugtakor dusk, éjjel night', L('vilagos/nappal') === 'day' && L('vilagos/alkony') === 'dusk' && L('vilagos/ejjel') === 'night', JSON.stringify(looked));
  check('Színes: nappal dusk (alkonyi fény), napnyugtakor dusk, éjjel night', L('szines/nappal') === 'dusk' && L('szines/alkony') === 'dusk' && L('szines/ejjel') === 'night', JSON.stringify(looked));
  check('Visszafogott: napszak szerint (nappal day), monochrome téma', L('visszafogott/nappal') === 'day' && L('visszafogott/ejjel') === 'night' && looked['visszafogott/nappal'].theme === 'monochrome', JSON.stringify(looked));
  check('Világos / Színes: a színes (default) téma; sötét rendszer-módban is ugyanez', looked['vilagos/nappal'].theme === 'default' && looked['szines/nappal'].theme === 'default');
  check('erősebb üveg csak a nappali fényű Világos térképen', looked['vilagos/nappal'].look === 'vilagos' && looked['vilagos/ejjel'].look === 'normal' && looked['szines/nappal'].look === 'normal', JSON.stringify(looked));

  // kézi átlagmérés navigáció nélkül: a nagy kártya marad
  const kn = await mk(SHOT);
  await kn.goto('/?navsim&panel=0');
  await kn.waitFor(MAP_READY, 60_000, 'térkép');
  await kn.waitFor(q('button[aria-label="Kézi átlagmérés indítása"]'), 20_000, 'stopper');
  await click(kn, 'button[aria-label="Kézi átlagmérés indítása"]');
  await sleep(6500);
  check('navigáció nélkül a kézi mérés nagy kártyája marad (nincs zsugorított kártya)', await kn.evaluate(`!!${q('.hud .card[aria-label="Kézi átlagmérés"] .btn.danger')} && !${q('.manual-mini')}`));
  await kn.close();

  // AW16: navigáció közben 5 s után (vagy közeli manővernél) a zsugorított kártya a jobb oldalon: nagy átlag státusz-színnel,
  // „km/h átlag”, idő; bökésre a teljes kártya, újabb bökésre zsugorított; a kézi mérés privát (nincs hálózati hívás)
  const MANUAL_CARD = q('.hud .card[aria-label="Kézi átlagmérés"]');
  const kp = await mk(SHOT);
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
  // AW22: ManualMini mellett a „Vissza a helyemre” a jobb oldali gombsor fölött; a mini és a gombsor a helyén marad
  {
    // teljes módban futnak az animációk: a beállt helyzetet mérjük
    await sleep(800);
    // AW24: a Bejelentés-gomb helyét is a beállt állapotban (a gombsor és a mini animációi lefutottak), teljes módban 800 ms nem mindig elég
    await kp.waitFor(`[...document.querySelectorAll('.actions *, .manual-mini')].every((e) => e.getAnimations().every((a) => a.playState === 'finished'))`, 15_000, 'a gombsor beállt');
    const before = await kp.evaluate(`(() => { const m = ${q('.manual-mini')}.getBoundingClientRect(); const r = ${q('.actions .report')}.getBoundingClientRect(); return { miniL: m.left, miniR: m.right, repL: r.left, repT: r.top }; })()`);
    const m = (type, x, y, extra = {}) => kp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1, ...extra });
    await m('mousePressed', 180, 300);
    await m('mouseMoved', 230, 340);
    await m('mouseMoved', 270, 380);
    await m('mouseReleased', 270, 380, { buttons: 0 });
    await kp.waitFor(q('.actions-upper .recenter'), 15_000, 'gomb a gombsor fölött');
    // a `rise` animáció végét pollozzuk: teljes módban a ritka rAF miatt 800 ms sem mindig elég (AW24)
    await kp.waitFor(`getComputedStyle(${q('.actions-upper .recenter')}).transform === 'none' || document.querySelector('.actions-upper .recenter').getAnimations().every((a) => a.playState === 'finished')`, 15_000, 'a gomb animációja véget ért');
    const up = await kp.evaluate(`(() => { const b = ${q('.actions-upper .recenter')}.getBoundingClientRect(); const m = ${q('.manual-mini')}; const mr = m?.getBoundingClientRect(); const r = ${q('.actions .report')}.getBoundingClientRect(); return { miniL: mr?.left, miniR: mr?.right, repL: r.left, repT: r.top, right: innerWidth - b.right, gap: r.top - b.bottom, sameX: b.left === r.left, slot: !!${q('.actions .recenter-slot')} }; })()`);
    check('AW23: ManualMini mellett a „Vissza a helyemre” a Bejelentés fölött (12 px)', up.right === 12 && up.gap === 12 && up.sameX, JSON.stringify(up));
    // a mini megjelenési animációja (képkészítő módban nincs reduced-motion) még tarthat: 2 px-en belül
    check('AW22: a gomb megjelenésére a mini és a Bejelentés nem mozdul', Math.abs(up.miniL - before.miniL) <= 2 && Math.abs(up.miniR - before.miniR) <= 2 && up.repL === before.repL && up.repT === before.repT, JSON.stringify({ before, up }));
    await click(kp, '.actions-upper .recenter');
    await kp.waitFor(`!${q('.actions .recenter')}`, 10_000, 'visszaállt a követés');
  }
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
  await kp.close();

  // ------------------------------------------------------------------
  // AOS14: köszöntés, köszönés a navigáció indításakor, „Még ott van?”
  // ------------------------------------------------------------------
  const gk = await mk(SHOT);
  await gk.goto('/?navsim&panel=0', { megszolitas: 'Kristof' });
  await gk.waitFor(MAP_READY, 60_000, 'térkép');
  await gk.waitFor(q('.greeting'), 20_000, 'köszöntés');
  const grt = await gk.evaluate(`(() => { const e = ${q('.greeting')}; const r = e.getBoundingClientRect(); const s = ${q('button[aria-label="Úti cél keresése"]')}.getBoundingClientRect(); return { txt: e.innerText.trim(), top: r.top, left: r.left, bottom: r.bottom, sBottom: s.bottom, h: innerHeight }; })()`);
  check('köszöntés kitöltött megszólítással: „Szia Kristof!”, a kereső-gomb sora alatt, balra – nem a térkép közepén', grt.txt === 'Szia Kristof!' && grt.top >= grt.sBottom && grt.left <= 20 && grt.bottom < grt.h * 0.3, JSON.stringify(grt));
  if (!CHECK_ONLY) {
    await sleep(2500);
    await gk.shot(`${DATE}-koszontes.png`);
  }
  await gk.close();
  const gn = await mk(SHOT);
  await gn.goto('/?navsim&panel=0');
  await gn.waitFor(q('.greeting'), 60_000, 'köszöntés név nélkül');
  check('köszöntés üres megszólítással: „Szia!”', (await gn.evaluate(text('.greeting'))) === 'Szia!');
  await gn.close();
  const gvo = await mk(SHOT);
  await gvo.goto('/?navsim&stage=nav&speed=1&at=20&panel=0', { megszolitas: 'Kristof' });
  await gvo.waitFor(q('.nav-top'), 60_000, 'navigáció');
  await sleep(500);
  const gvoices = await gvo.evaluate(`(window.__navVoice ?? []).map((v) => v.text)`);
  check('navigáció indításakor köszönés: „Szia Kristof, indulhatunk!” (az indulási utasítás előtt)', gvoices[0] === 'Szia Kristof, indulhatunk!', gvoices.slice(0, 3).join(' | '));
  check('navigáció közben nincs köszöntő felirat', !(await gvo.evaluate(`!!${q('.greeting')}`)));
  await gvo.close();
  // AOS14 javítás: EGY kártya a kamera-figyelmeztetés helyén – navigáció nélkül önállóan a felső kártya helyén; előbb
  // „Rendőrség 240 m”, 50 m-rel a bejelentés előtt UGYANAZ az elem helyben „Még ott van? Igen / Nem”; az elhaladás után még
  // 10 s-ig (szimulált idő; a valós idő = ennek és a lejátszási sebességnek a hányadosa), válaszra azonnal eltűnik
  const rpg = await mk(SHOT);
  const RPG_SPEED = fast(4, 2);
  await rpg.goto(`/?sim=jo&speed=${RPG_SPEED}&panel=0`);
  await rpg.waitFor(MAP_READY, 60_000, 'térkép');
  // a kártya állapotának naplója: minden DOM-változásra (MutationObserver), nem időzítőre – a 100 ms-es mintavétel a képkészítő mód terhelésénél
  // lemaradt egy-egy 250 ms-ig látszó értékről (AOS18-javítás: „lastApproachM: 100”), a feltétel a mintavétel ütemétől függött, nem az apptól
  await rpg.evaluate(`window.__alertLog = []; window.__alertTimer = new MutationObserver(() => { const r = document.querySelector('.report-alert-row'); const e = { t: performance.now(), phase: r?.dataset.phase ?? null, txt: r?.querySelector('b')?.textContent.trim() ?? null }; const l = window.__alertLog.at(-1); if (!l || l.phase !== e.phase || l.txt !== e.txt) window.__alertLog.push(e); }); window.__alertTimer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-phase'] }); true`);
  await rpg.waitFor(`${q('.report-alert .report-alert-row')}?.dataset.phase === 'approach'`, 90_000, 'közeledő bejelentés');
  const ap = await rpg.evaluate(`(() => { const c = ${q('.nav-top.report-alert')}; window.__alertEl = c.querySelector('.report-alert-row'); const r = c.getBoundingClientRect(); return { txt: c.innerText.replace(/\\s+/g, ' ').trim(), top: r.top, cam: c.dataset.camera, n: document.querySelectorAll('.report-alert-row').length, bottomCard: !!document.querySelector('.report-card') }; })()`);
  check('közeledéskor figyelmeztető kártya felül (a kamera-figyelmeztetés stílusában): „Rendőrség 2xx m”', /^Rendőrség \d+ m$/.test(ap.txt) && ap.cam === 'true' && ap.top < 200 && ap.n === 1 && !ap.bottomCard, JSON.stringify(ap));
  await rpg.waitFor(`${q('.report-alert-row')}?.dataset.phase === 'ask'`, 60_000, 'kérdés-fázis');
  const rpr = await rpg.evaluate(`(() => { const row = ${q('.report-alert-row')}; const app = window.__alertLog.filter((x) => x.phase === 'approach').map((x) => Number(/(\\d+) m$/.exec(x.txt ?? '')?.[1])).filter((d) => d > 0); return { same: row === window.__alertEl, q: row.querySelector('.report-alert-q')?.innerText.trim(), btns: [...row.querySelectorAll('.btn')].map((b) => b.innerText.trim()), h: Math.min(...[...row.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect().height)), n: document.querySelectorAll('.report-alert-row').length, bottomCard: !!document.querySelector('.report-card'), lastApproachM: app.at(-1) }; })()`);
  // a fixek ~33 m-enként jönnek (120 km/h): az utolsó figyelmeztetés 50 m fölött, legfeljebb egy lépéssel előtte
  check('50 m-rel a bejelentés előtt ugyanaz az elem helyben vált: „Még ott van?” Igen / Nem (≥ 56 px), nincs új kártya', rpr.same && rpr.q === 'Még ott van?' && rpr.btns.join('|') === 'Igen|Nem' && rpr.h >= 56 && rpr.n === 1 && !rpr.bottomCard && rpr.lastApproachM > 50 && rpr.lastApproachM <= 90, JSON.stringify(rpr));
  await rpg.evaluate(`${q('.report-alert-row .btn')}.click(); true`);
  await sleep(400);
  check('„Igen”: köszönő toast, a kártya azonnal eltűnik', /megerősítve/.test(await rpg.evaluate(text('.toast'))) && !(await rpg.evaluate(`!!${q('.report-alert-row')}`)));
  // a következő (Veszély): válasz nélkül az elhaladás után még 10 s-ig látszik, aztán magától eltűnik
  await rpg.waitFor(`${q('.report-alert-row')}?.dataset.phase === 'ask'`, 120_000, 'következő kérdés');
  const askAt = await rpg.evaluate(`performance.now()`);
  const nextTitle = await rpg.evaluate(`${q('.report-alert-row b')}?.innerText.trim() ?? null`);
  await rpg.waitFor(`!/Veszély/.test(${q('.report-alert-row b')}?.innerText ?? '')`, 30_000, 'magától eltűnik');
  const shownSim = (((await rpg.evaluate(`performance.now()`)) - askAt) / 1000) * RPG_SPEED;
  check('arra a bejelentésre nem tér vissza; a következő kérdés válasz nélkül az elhaladás után ~10 s-mal magától eltűnik', nextTitle === 'Veszély' && shownSim >= 9.2 && shownSim < 32, `${nextTitle}, ${shownSim.toFixed(1)} s szimulált (${RPG_SPEED}× lejátszás)`);
  // egy kapu-tétel: „Átlagmérés eleje” → elküldve (a szerver-hívás itt elfogva) → ugyanaz a sor „Átlagmérés vége”
  await rpg.evaluate(`window.__gateCalls = []; const f0 = window.fetch; window.fetch = (...a) => { const u = String(a[0]?.url ?? a[0]); if (/\\/rest\\/v1\\/reports/.test(u)) { window.__gateCalls.push(u); return Promise.resolve(new Response(JSON.stringify([{ id: '00000000-0000-4000-8000-0000000000a1' }]), { status: 201, headers: { 'content-type': 'application/json' } })); } return f0(...a); }; true`);
  await click(rpg, 'button[aria-label="Bejelentés"]');
  await rpg.waitFor(q('.sheet .tiles'), 5000, 'bejelentés-menü');
  const g1 = await rpg.evaluate(`[...document.querySelectorAll('.sheet .tile')].map((t) => t.innerText.trim())`);
  check('Bejelentés menü: 9 tétel (AW18: + Dugó, Beállt), a végén EGY kapu-tétel „Átlagmérés eleje”', g1.length === 9 && g1.at(-1) === 'Átlagmérés eleje' && !g1.includes('Átlagmérés vége'), g1.join(' | '));
  await click(rpg, '.sheet .tile[data-gate]');
  // fix alvás helyett: megvárjuk a küldést és a lap bezárását (különben a második megnyitás a bezáródó lapot látja)
  await rpg.waitFor(`window.__gateCalls.length === 1 && !${q('.sheet')}`, 5000, 'kapu elküldve, lap bezárva').catch(() => undefined);
  await click(rpg, 'button[aria-label="Bejelentés"]');
  await rpg.waitFor(q('.sheet .tiles'), 5000, 'bejelentés-menü 2');
  const g2 = await rpg.evaluate(`({ tiles: [...document.querySelectorAll('.sheet .tile')].map((t) => t.innerText.trim()), note: ${text('.sheet-note')}, calls: window.__gateCalls.length })`);
  check('elküldés után ugyanaz a sor „Átlagmérés vége”, a jegyzet a végére emlékeztet', g2.calls === 1 && g2.tiles.length === 9 && g2.tiles.at(-1) === 'Átlagmérés vége' && /végét/.test(g2.note), JSON.stringify(g2));
  if (!CHECK_ONLY) await rpg.shot(`${DATE}-bejelentes-menu-vege.png`);
  check('nincs kezeletlen JS-kivétel (AOS14)', rpg.logs.length === 0 && gk.logs.length === 0, [...rpg.logs, ...gk.logs].join(' | '));
  await rpg.evaluate('window.__alertTimer.disconnect(); true').catch(() => undefined);
  await rpg.close();
  // AOS18-javítás: a „Vissza a helyemre” mindig a gombsor jobb szélén, a gombsor és az alatta lévő kártya között 12 px; táblával és tábla nélkül ugyanott
  {
    const rc = await mk();
    const dragMap = async () => {
      const m = (type, x, y, extra = {}) => rc.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1, ...extra });
      await m('mousePressed', 180, 280);
      await m('mouseMoved', 240, 330);
      await m('mouseMoved', 280, 380);
      await m('mouseReleased', 280, 380, { buttons: 0 });
    };
    const place = `(() => { const b = ${q('.actions .recenter')}; const r = b?.getBoundingClientRect(); const rep = ${q('.actions .report')}.getBoundingClientRect(); const next = ${q('.actions')}.nextElementSibling?.getBoundingClientRect(); return r ? { right: innerWidth - r.right, gap: next ? next.top - r.bottom : null, overReport: r.left === rep.left && rep.top - r.bottom === 12, float: !!${q('.hud-float .recenter')}, sign: !!${q('.actions-upper .sign')} } : null; })()`;
    await rc.goto('/?navsim&panel=0&heat=ki&speed=7');
    await rc.waitFor(MAP_READY, 60_000, 'térkép');
    check('AOS18-javítás: a követés alatt nincs „Vissza a helyemre”', await rc.evaluate(`!${q('.recenter')}`));
    await dragMap();
    await rc.waitFor(q('.actions .recenter'), 15_000, 'gomb');
    const free = await rc.evaluate(place);
    check('AW23: „Vissza a helyemre” tábla nélkül a Bejelentés fölött (12 px a széltől)', free.right === 12 && free.overReport && !free.float && !free.sign, JSON.stringify(free));
    await rc.goto('/?navsim&stage=nav&panel=0&speed=7&at=60');
    await rc.waitFor(`${q('.nav-top')} && ${q('.actions-upper .sign')}`, 60_000, 'navigáció táblával');
    await dragMap();
    await rc.waitFor(q('.actions .recenter'), 15_000, 'gomb táblával');
    const signed = await rc.evaluate(place);
    check('AW23: táblával is ugyanott', signed.right === 12 && signed.overReport && !signed.float && signed.sign, JSON.stringify(signed));
    await rc.close();
  }
  // navigáció közben a manőverkártya alatt (a kamera-sor helyén), ugyanígy
  const rn = await mk(SHOT);
  await rn.goto(`/?navsim&stage=nav&speed=${fast(2, 3)}&at=40&panel=0`);
  await rn.waitFor(q('.nav-top'), 60_000, 'navigáció');
  await rn.waitFor(q('.nav-top:not(.report-alert) .report-alert-row'), 120_000, 'bejelentés a manőverkártyán');
  const rnv = await rn.evaluate(`(() => { const top = ${q('.nav-top:not(.report-alert)')}; const row = top.querySelector('.report-alert-row'); const main = top.querySelector('.nav-main').getBoundingClientRect(); return { below: row.getBoundingClientRect().top >= main.bottom - 1, cam: top.dataset.camera, alone: !!document.querySelector('.nav-top.report-alert') }; })()`);
  check('navigációban a bejelentés a manőverkártya alatt, a kamera-sor helyén (borostyán kártya), nem külön elemként', rnv.below && rnv.cam === 'true' && !rnv.alone, JSON.stringify(rnv));
  await rn.waitFor(`${q('.report-alert-row')}?.dataset.phase === 'ask'`, 60_000, 'kérdés a navigációban');
  if (!CHECK_ONLY) await rn.shot(`${DATE}-nav-meg-ott-van.png`);
  await rn.close();

  // ------------------------------------------------------------------
  // AW18: útvonalválasztó, forgalom, dugó, újratervezés-hiba, menü
  // ------------------------------------------------------------------
  const pk = await mk(REAL);
  await pk.goto('/?navsim&stage=picker&fasterAlt&speed=1&panel=0');
  await pk.waitFor(MAP_READY, 60_000, 'térkép');
  await pk.waitFor(`document.querySelectorAll('.route-opt').length === 2 && ${q('.route-label')}`, 30_000, 'útvonalválasztó');
  await sleep(1000);
  const pk1 = await pk.evaluate(`(() => { const o = [...document.querySelectorAll('.route-opt')]; return { tags: o.map((x) => x.querySelector('.route-opt-tag').innerText.trim()), times: o.map((x) => x.querySelector('b').innerText.trim()), checked: o.map((x) => x.getAttribute('aria-checked')), label: ${text('.route-label')} }; })()`);
  check('AW23: a „Leggyorsabb” legfelül és előválasztva, akkor is, ha a Directions a 2. helyen adja', pk1.tags.join('|') === 'Leggyorsabb|Alternatíva 1' && pk1.checked.join('|') === 'true|false', JSON.stringify(pk1));
  check('AOS16: az útvonalválasztóban nincs kereső-gomb és köszöntés (csak az üres nézeten)', await pk.evaluate(`!document.querySelector('.top-search') && !document.querySelector('.greeting')`));
  await pk.evaluate(`document.querySelectorAll('.route-opt')[1].click(); true`);
  await pk.waitFor(`/−1 perc/.test(${text('.route-label')})`, 10_000, 'címke a gyorsabbon').catch(() => undefined);
  const pk2 = await pk.evaluate(`({ label: ${text('.route-label')}, times: [...document.querySelectorAll('.route-opt b')].map((x) => x.innerText.trim()) })`);
  check('AW18: a lassabb kiválasztva a gyorsabb alternatíván „−1 perc” (a kártyák kerekített perceiből)', pk2.label === '−1 perc', JSON.stringify(pk2));
  await pk.close();

  // dugó mód: a friss Mapbox-lekérés dugót mutat, a vezetés araszol (a bejelentés-küldés itt elfogva)
  const tr = await mk(SHOT);
  await tr.goto(`/?navsim&stage=nav&traffic&speed=${fast(12, 2)}&panel=0`);
  await tr.waitFor(q('.nav-top'), 60_000, 'navigáció');
  await tr.evaluate(`window.__repCalls = []; const f0 = window.fetch; window.fetch = (...a) => { const u = String(a[0]?.url ?? a[0]); if (/\\/rest\\/v1\\/reports/.test(u)) { window.__repCalls.push(u); return Promise.resolve(new Response(JSON.stringify([{ id: '00000000-0000-4000-8000-0000000000b1' }]), { status: 201, headers: { 'content-type': 'application/json' } })); } return f0(...a); }; true`);
  await tr.waitFor(q('.nav-delay'), 120_000, '+N perc dugó');
  // a sáv a nézetből jön, a hang a következő óra-lépésben: nem azonos pillanat (AW22: egy teljes futásban ezen bukott)
  await tr.waitFor(`(window.__navVoice ?? []).some((v) => v.kind === 'traffic')`, 10_000, 'dugó-hang').catch(() => undefined);
  const tr1 = await tr.evaluate(`({ text: ${text('.nav-delay')}, color: getComputedStyle(${q('.nav-delay')}).color, voice: (window.__navVoice ?? []).filter((v) => v.kind === 'traffic').map((v) => v.text), sameLine: (() => { const d = ${q('.nav-delay')}.getBoundingClientRect(); const b = ${q('.nav-bottom-eta b')}.getBoundingClientRect(); const e = ${q('.nav-end')}.getBoundingClientRect(); return d.bottom <= b.top + 2 && Math.abs(d.left - b.left) < 2 && d.right <= e.right && d.width > 60; })() })`);
  check('AW18: a friss forgalmi lekérés után „+N perc dugó” borostyánban közvetlenül az érkezési idő fölött (teljesen látszik), hanggal', /^\+\d+ perc dugó$/.test(tr1.text) && tr1.color === 'rgb(255, 178, 36)' && tr1.sameLine && tr1.voice.some((v) => /^Dugó az útvonalon, az érkezés \d+ perccel később\.$/.test(v)), JSON.stringify(tr1));
  // kis képernyőn a felső kártya sávvá zsugorodik, a kérdés önálló kártyán látszik: mindig a látható sort mérjük
  const JAM_ROW = `[...document.querySelectorAll('.nav-top .jam-ask-row')].find((e) => e.innerText.trim())`;
  await tr.waitFor(JAM_ROW, 240_000, 'Dugóba kerültél?');
  const tr2 = await tr.evaluate(`(() => { const row = ${JAM_ROW}; const top = row.closest('.nav-top'); return { q: row.querySelector('.report-alert-q').innerText.trim(), btns: [...row.querySelectorAll('.btn')].map((b) => b.innerText.trim()), below: !top.querySelector('.nav-main') || row.getBoundingClientRect().top >= top.querySelector('.nav-main').getBoundingClientRect().bottom - 1, amber: top.dataset.camera, voice: (window.__navVoice ?? []).filter((v) => /Dugóba kerültél/.test(v.text)).length, jam: (window.__navJam ?? []).map((x) => x.kind), pins: document.querySelectorAll('.report-pin').length }; })()`);
  check('AW18: dugóba lépéskor „Dugóba kerültél? Igen / Nem” a manőverkártya alatt (a „Még ott van?” helyén), hang egyszer, érzékelt minta', tr2.q === 'Dugóba kerültél?' && tr2.btns.join('|') === 'Igen|Nem' && tr2.below && tr2.amber === 'true' && tr2.voice === 1 && tr2.jam.includes('erzekelt'), JSON.stringify(tr2));
  await tr.evaluate(`window.__toasts = []; new MutationObserver(() => { const t = document.querySelector('.toast'); if (t) window.__toasts.push(t.innerText.trim()); }).observe(document.body, { childList: true, subtree: true }); true`);
  await tr.evaluate(`${q('.jam-ask-row .btn')}.click(); true`);
  await tr.waitFor(`window.__repCalls.length === 1 && !${q('.jam-ask-row')}`, 5000, 'Igen elküldve').catch(() => undefined);
  await sleep(600);
  const tr3 = await tr.evaluate(`({ calls: window.__repCalls.length, ask: !!${q('.jam-ask-row')}, pins: document.querySelectorAll('.report-pin').length, dugoPin: [...document.querySelectorAll('.report-pin')].some((e) => e.innerHTML.includes('M10.5 9.5 12 5h8')), toast: (window.__toasts ?? []).join(' | '), jam: (window.__navJam ?? []).map((x) => x.kind) })`);
  check('AW18: „Igen” → „Dugó” bejelentés a pozícióra (a térképen), bejelentett közösségi minta, a kártya eltűnik', tr3.calls === 1 && !tr3.ask && tr3.dugoPin && tr3.pins === tr2.pins + 1 && /Dugó/.test(tr3.toast) && tr3.jam.includes('bejelentett'), JSON.stringify(tr3));
  check('nincs kezeletlen JS-kivétel (AW18 dugó)', tr.logs.length === 0, tr.logs.join(' | '));
  await tr.close();

  // újratervezés-hiba: visszaszámlálás, koppintásra azonnali próba, az ok a naplóban
  const rf = await mk(SHOT);
  const RF_SPEED = fast(2, 8);
  await rf.goto(`/?navsim&stage=nav&rerouteFail&speed=${RF_SPEED}&panel=0`);
  await rf.waitFor(q('.nav-top'), 60_000, 'navigáció');
  await rf.evaluate(`window.__warns = []; const w0 = console.warn; console.warn = (...a) => { window.__warns.push(a.map(String).join(' ')); w0(...a); }; true`);
  await rf.waitFor(`${q('button.nav-reroute small')}`, 240_000, 'nem sikerült kártya');
  const rf1 = await rf.evaluate(`({ title: ${text('button.nav-reroute span span')}, small: ${text('button.nav-reroute small')}, warns: window.__warns.filter((x) => x.includes('[nav] reroute failed')) })`);
  // AW23: a következő kiírt másodpercig pollozva (fix várakozásnál gyorsított módban a próba már elindulhatott, és a felirat üres volt)
  await rf.waitFor(`(() => { const t = ${text('button.nav-reroute small')}; return t && t !== ${JSON.stringify(rf1.small)}; })()`, 15_000, 'fogy a visszaszámlálás').catch(() => undefined);
  const rf2 = await rf.evaluate(`({ small: ${text('button.nav-reroute small')}, n: window.__warns.filter((x) => x.includes('[nav] reroute failed')).length })`);
  const secs = (x) => Number(/(\d+) mp/.exec(x)?.[1] ?? NaN);
  check('AW18: „Az újratervezés nem sikerült – próbálom újra”, alatta a következő próbáig hátralévő másodperc, fogy; az ok (http_503) a konzolon', rf1.title === 'Az újratervezés nem sikerült – próbálom újra' && /^Újra \d+ mp múlva – koppints most$/.test(rf1.small) && secs(rf2.small) < secs(rf1.small) && rf1.warns.some((x) => x.includes('http_503')), JSON.stringify({ rf1, rf2 }));
  // a 2. hiba után 10 s a várakozás; amikor az előző hívás már 5 s-nál régebbi (a Directions-korlát), a koppintás azonnal próbál
  await rf.waitFor(`window.__warns.filter((x) => x.includes('[nav] reroute failed')).length === 2`, 60_000, '2. próba');
  await rf.waitFor(`Number(/(\\d+) mp/.exec(${text('button.nav-reroute small')})?.[1] ?? 99) <= 3`, 30_000, 'a korlát letelt');
  const before = await rf.evaluate(`window.__warns.filter((x) => x.includes('[nav] reroute failed')).length`);
  await rf.evaluate(`${q('button.nav-reroute')}.click(); true`);
  await sleep(500);
  const rf3 = await rf.evaluate(`({ n: window.__warns.filter((x) => x.includes('[nav] reroute failed')).length, last: window.__warns.at(-1), small: ${text('button.nav-reroute small')} })`);
  check('AW18: koppintásra azonnal újrapróbál (új próba a naplóban, a következő várakozás 20 s)', rf3.n === before + 1 && /attempt 3, retry in 20 s/.test(rf3.last), JSON.stringify({ before, rf3 }));
  await rf.close();

  // ------------------------------------------------------------------
  // AW19: krúzing mód, utak naplója, statisztika (IndexedDB, csak helyben)
  // ------------------------------------------------------------------
  let CLEAR_TRIPS;
  {
    // az előző lapok már bezárultak (egy Chrome, egy lap); az IndexedDB-t az első lap kiüríti, mielőtt útja lenne
    // a navsim teljes vezetése ezt az utat adja (a webes `SIM_TRIP` – navSim.ts; a navSim.test.ts és a Swift SimTests is ezt méri)
    const SIM_TRIP = { distanceM: 17_677, movingS: 792, idleS: 0, maxKmh: 128, turns: { left: 0, right: 0, uTurn: 0 }, dirChanges: { left: 1, right: 3, uTurn: 0 }, pieces: 3, samples: 793 };
    const TRIPS_DB = `(async () => {
      if (!(await indexedDB.databases()).some((d) => d.name === 'atlagsebesseg-trips')) return { trips: [], samples: [] };
      const db = await new Promise((res, rej) => { const o = indexedDB.open('atlagsebesseg-trips'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
      const all = (store) => new Promise((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
      const out = { trips: await all('trips'), samples: await all('samples') };
      db.close();
      return out;
    })()`;
    // tranzakcióval, nem deleteDatabase-szel: az utóbbi egy nyitott kapcsolat mellett „blocked” marad, és minden későbbi open mögé áll
    CLEAR_TRIPS = `new Promise((res, rej) => { const o = indexedDB.open('atlagsebesseg-trips'); o.onerror = () => rej(o.error); o.onsuccess = () => { const db = o.result; const names = ['trips', 'samples', 'heat', 'heatTrips', 'tracks', 'trashTracks'].filter((n) => db.objectStoreNames.contains(n)); const tx = db.transaction(names, 'readwrite'); for (const n of names) tx.objectStore(n).clear(); tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }; })`;

    // 1) krúzing: cél nélkül, a navsim-vezetés rögtön indul; 30 s mozgás után az állapotsor a köszöntés alatt
    const cr = await mk(SHOT);
    await cr.goto(`/?cruise&speed=${fast(3, 3)}&panel=0`);
    await cr.waitFor(MAP_READY, 60_000, 'térkép');
    await cr.evaluate(CLEAR_TRIPS);
    await cr.waitFor(q('.cruise-card[data-kind="full"]'), 60_000, 'krúzing-kártya');
    const crs = await cr.evaluate(`(() => { const e = ${q('.cruise-card')}; const r = e.getBoundingClientRect(); return { big: e.querySelector('.cruise-big').innerText.replace(/\\s+/g, ' ').trim(), line: e.querySelector('.cruise-line').innerText, greeting: !!${q('.greeting')}, bg: getComputedStyle(e).backgroundColor, top: r.top, inView: r.right <= innerWidth, searchBottom: document.querySelector('.top-search')?.getBoundingClientRect().bottom ?? null }; })()`);
    check('AW24: krúzing – cél nélkül, mozgás után a krúzing-kártya: táv + idő, átlag · irányváltások, égkék háttér, köszöntés nélkül', /^[\d,]+ (km|m) \d+ perc$/.test(crs.big) && /^átlag \d+ km\/h · \d+ irányváltás$/.test(crs.line) && !crs.greeting && crs.bg === 'rgb(27, 120, 186)' && crs.inView, JSON.stringify(crs));
    // AW24 (INV-19 módosítva): a kártya a kerek kereső-gomb ALATT kezdődik (8 px-re), nem fedik egymást
    check('AW24: a krúzing-kártya a kereső-gomb alatt, 8 px-re (nem fedik egymást)', crs.searchBottom !== null && Math.round(crs.top - crs.searchBottom) === 8, JSON.stringify(crs));
    if (!CHECK_ONLY) {
      await sleep(2500);
      await cr.shot(`${DATE}-aw24-krusing-kartya.png`);
    }
    await cr.close();

    // a teljes vezetés gyorsan: a lejátszás vége (a „GPS” leáll) zárja az utat; előtte az előző lap (bezáráskor mentett) útja törlődik
    const cf = await mk(SHOT);
    await cf.goto('/');
    await cf.waitFor(q('.mapboxgl-canvas'), 60_000, 'térkép');
    await cf.evaluate(CLEAR_TRIPS);
    await cf.goto('/?cruise&speed=60&panel=0');
    await cf.waitFor(MAP_READY, 60_000, 'térkép');
    const deadline = Date.now() + 120_000;
    let db = { trips: [], samples: [] };
    while (Date.now() < deadline) {
      db = await cf.evaluate(TRIPS_DB);
      if (db.trips.length > 0) break;
      await sleep(500);
    }
    const tr = db.trips[0] ?? null;
    // tárhely-becslés (tájékoztató): az IndexedDB mérete a 793 mintával + a rekorddal
    const idbBytes = await cf.evaluate(`navigator.storage.estimate().then((e) => e.usageDetails?.indexedDB ?? e.usage ?? 0)`);
    console.log(`  info: IndexedDB ${Math.round(idbBytes / 1024)} KB / ${db.samples.length} minta → ~${((idbBytes / Math.max(1, db.samples.length)) * 3600 / 1048576).toFixed(2)} MB / vezetési óra`);
    const got = tr && { distanceM: tr.distanceM, movingS: tr.movingS, idleS: tr.idleS, maxKmh: tr.maxKmh, turns: tr.turns, dirChanges: tr.dirChanges, pieces: tr.path.length, samples: tr.samples };
    check('AW19: a navsim-vezetés (krúzing) egy út a naplóban – km, menetidő, kanyar 0 (krúzing) és irányváltások (B/J/U), útvonal-darabok, mintaszám = SIM_TRIP', db.trips.length === 1 && JSON.stringify(got) === JSON.stringify(SIM_TRIP), JSON.stringify(got));
    check('AW19: krúzing-út: cél nélkül („Krúzing”), a szimulált M1-szakasz mérése a rekordban (1, rendben)', tr?.destination === null && tr?.measurements.length === 1 && tr.measurements[0].sectionId === 'SIM-M1-NAV' && tr.measurements[0].tooFast === false, JSON.stringify(tr?.measurements));
    const s0 = db.samples.filter((s) => s.tripId === tr?.id);
    check('AW19: 1 Hz-es minták a helyi tárolóban (pozíció, sebesség, irány, pontosság, időbélyeg) H3-cellával (res 10)', s0.length === SIM_TRIP.samples && s0.every((s) => /^8a[0-9a-f]{13}$/.test(s.h3 ?? '')) && ['lat', 'lon', 't', 'speedKmh', 'heading', 'accuracy'].every((k) => k in s0[0]), `${s0.length} minta, ${JSON.stringify(s0[0])}`);
    check('AW19: az útvonal egyszerűsítve (Douglas–Peucker 10 m): a minták töredéke', tr && tr.path.flat().length < s0.length / 5, `${tr?.path.flat().length} pont / ${s0.length} minta`);

    // Beállítások › „Utak naplója” – a Mentett helyek fölött; a lap: összesítő kártya + lista
    await click(cf, 'button[aria-label="Beállítások"]');
    await cf.waitFor(q('.trips-entry .nav-row'), 5000, 'napló-sor');
    const entry = await cf.evaluate(`(() => { const e = ${q('.trips-entry')}; const labels = [...document.querySelectorAll('.sheet .group-label')]; const places = labels.find((l) => l.innerText.trim().toLowerCase() === 'mentett helyek'); return { txt: e.innerText.trim(), above: !!places && e.getBoundingClientRect().bottom <= places.getBoundingClientRect().top, chevron: !!e.querySelector('svg') }; })()`);
    check('AW19: Beállítások – „Utak naplója” sor a Mentett helyek fölött, nyíllal', entry.txt === 'Utak naplója' && entry.above && entry.chevron, JSON.stringify(entry));
    await click(cf, '.trips-entry .nav-row');
    await cf.waitFor(`${q('.trip-row')} && ${q('.trip-stats')}`, 10_000, 'napló-lap');
    const lst = await cf.evaluate(`(() => ({ title: ${text('.sheet-head .title')}, rows: [...document.querySelectorAll('.trip-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()), stats: [...document.querySelectorAll('.trip-stat')].map((s) => s.innerText.replace(/\\s+/g, ' ').trim()), period: [...document.querySelectorAll('.trip-stats .segmented button')].map((b) => b.innerText.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')), all: !!${q('.trip-delete-all .mini-btn')}, overflow: document.documentElement.scrollWidth > innerWidth }))()`);
    check('AW19: Napló – a sor: dátum · „Krúzing” · km · idő · átlag, alatta a kanyarok és az irányváltások száma (krúzingban 0 kanyar)', lst.title === 'Utak naplója' && lst.rows.length === 1 && /Krúzing 17,7 km · 13 perc · 80 km\/h 0 kanyar · 4 irányváltás$/.test(lst.rows[0]) && /^\S+ \d+\. \d\d:\d\d /.test(lst.rows[0]), JSON.stringify(lst.rows));
    check('AW19: statisztika – időszakváltó (ez a hét / hónap / összes), táv, menetidő, utak, átlag, kanyarok B/J/U, szakaszmérések, dugóidő', lst.period.join('|') === 'Ez a hét*|Ez a hónap|Összes' && lst.stats.join(' | ') === 'Összes táv 17,7 km | Menetidő 13 perc | Utak 1 | Átlag 80 km/h | Kanyarok B 0 · J 0 · U 0 | Irányváltások B 1 · J 3 · U 0 | Szakaszmérések 1 rendben · 0 túl gyors | Dugóban 0 perc' && lst.all && !lst.overflow, JSON.stringify(lst));
    if (!CHECK_ONLY) {
      await sleep(600);
      await cf.shot(`${DATE}-aw19-naplo-lista.png`);
    }
    // részlet: kis térkép az útvonallal (Visszafogott), a számok, a szakaszmérések
    await click(cf, '.trip-row-main');
    await cf.waitFor(`${q('.trip-map')} && window.__tripMapReady`, 30_000, 'út-térkép');
    const det = await cf.evaluate(`(() => ({ title: ${text('.sheet-head .title')}, rows: [...document.querySelectorAll('.trip-detail .list-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()), mapH: Math.round(${q('.trip-map')}.getBoundingClientRect().height), canvas: !!${q('.trip-map canvas')} }))()`);
    check('AW19: út részlete – kis térkép az útvonallal, a számok (táv, menet- / állásidő, átlag, max, kanyarok, újratervezés, dugó) és a szakaszmérés', det.title === 'Krúzing' && det.canvas && det.mapH === 220 && det.rows.includes('Táv 17,7 km') && det.rows.includes('Max sebesség 128 km/h') && det.rows.includes('Kanyarok B 0 · J 0 · U 0') && det.rows.includes('Irányváltások B 1 · J 3 · U 0') && det.rows.some((r) => /^M1 · Budapest → Győr \d\d:\d\d · határ 110 km\/h \d+ km\/h rendben$/.test(r)), JSON.stringify(det));
    await click(cf, '.trip-back');
    await cf.waitFor(q('.trip-row'), 5000, 'vissza a listára');
    // törlés hosszú nyomásra: a sor végén „Törlés”, koppintásra az út a mintáival együtt eltűnik
    await cf.evaluate(`(() => { const b = ${q('.trip-row-main')}; const r = b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20, pointerType: 'touch' })); return true; })()`);
    // a felengedés csak az élesedés után: terhelt gépen az 500 ms-os időzítő késhet, és a korai felengedés törölné
    await cf.waitFor(`${q('.trip-row')}?.dataset.armed === 'true'`, 5000, 'törlés-gomb');
    await cf.evaluate(`(() => { const b = ${q('.trip-row-main')}; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })); b.click(); return true; })()`);
    const armedStill = await cf.evaluate(`!${q('.trip-map')}`);
    await click(cf, '.trip-row .mini-btn.danger');
    await cf.waitFor(`!${q('.trip-row')}`, 5000, 'törölt sor');
    const afterDel = await cf.evaluate(TRIPS_DB);
    check('AW19: törlés hosszú nyomásra – a „Törlés” gomb, az út és a mintái eltűnnek (a részlet nem nyílik meg)', armedStill && afterDel.trips.length === 0 && afterDel.samples.length === 0 && (await cf.evaluate(text('.sheet-note'))).startsWith('Még nincs rögzített út'), JSON.stringify({ trips: afterDel.trips.length, samples: afterDel.samples.length }));
    await cf.close();

    // 2) navigációval: a teljes Budapest → Győr út a céllal, az újratervezéssel és a méréssel; „Összes törlése” megerősítéssel
    const cn = await mk(SHOT);
    await cn.goto('/?navsim&stage=nav&speed=60&alt=maybe&panel=0');
    await cn.waitFor(MAP_READY, 60_000, 'térkép');
    const deadline2 = Date.now() + 120_000;
    let db2 = { trips: [], samples: [] };
    while (Date.now() < deadline2) {
      db2 = await cn.evaluate(TRIPS_DB);
      if (db2.trips.length > 0) break;
      await sleep(500);
    }
    const tn = db2.trips[0] ?? null;
    check('AW19: navigációval ugyanaz az út – a cél (Győr koordináta-kulcsa, AW25b), az újratervezés (letérés) és a szakaszmérés ugyanabban a rekordban', db2.trips.length === 1 && tn.destination === '@47.68750,17.65040' && tn.reroutes >= 1 && tn.measurements.length === 1 && tn.distanceM === SIM_TRIP.distanceM && JSON.stringify(tn.dirChanges) === JSON.stringify(SIM_TRIP.dirChanges) && tn.turns.left + tn.turns.right + tn.turns.uTurn >= 1, JSON.stringify({ dest: tn?.destination, reroutes: tn?.reroutes, m: tn?.measurements.length, d: tn?.distanceM, turns: tn?.turns, dir: tn?.dirChanges }));
    // a szerverre semmi: a navigációs szimulátor nem küld, a napló csak az IndexedDB-ben (a dugó-minták változatlanok)
    await cn.goto('/?navsim&panel=0&sheet=trips');
    await cn.waitFor(q('.trip-row'), 30_000, 'napló (?sheet=trips)');
    const navRow = await cn.evaluate(text('.trip-row'));
    check('AW19: a napló sora navigációs útnál a cél nevét mutatja, a kanyarok a navigáció manőveiből (>= 1), az irányváltás GPS-ből (4)', /Győr 17,7 km/.test(navRow) && /[1-9]\d* kanyar · 4 irányváltás$/.test(navRow), navRow);
    // a képek a navigációs útról: itt a kanyar és az irányváltás is van (a krúzing-útnál a kanyar 0)
    await click(cn, '.trip-row-main');
    await cn.waitFor(`${q('.trip-map')} && window.__tripMapReady`, 30_000, 'út-térkép (navigáció)');
    const navDet = await cn.evaluate(`[...document.querySelectorAll('.trip-detail .list-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
    check('AW19: út részlete navigációs útnál – Kanyarok és Irányváltások két külön sor', navDet.some((r) => /^Kanyarok B \d+ · J \d+ · U \d+$/.test(r) && !/^Kanyarok B 0 · J 0 · U 0$/.test(r)) && navDet.includes('Irányváltások B 1 · J 3 · U 0'), JSON.stringify(navDet));
    if (!CHECK_ONLY) {
      await sleep(3500);
      // a két számláló (Kanyarok, Irányváltások) a lap alsó felén van: a kép arra görgetve készül
      await cn.evaluate(`(() => { const rows = [...document.querySelectorAll('.trip-detail .list-row')]; const r = rows.find((x) => x.innerText.startsWith('Kanyarok')); const s = ${q('.sheet')}; s.scrollTop = s.scrollTop + r.getBoundingClientRect().top - 260; return true; })()`);
      await sleep(400);
      await cn.shot(`${DATE}-aw19-ut-reszlet.png`);
    }
    await click(cn, '.trip-back');
    await cn.waitFor(q('.trip-row'), 5000, 'vissza a listára (navigáció)');
    if (!CHECK_ONLY) {
      await click(cn, '.trip-stats .segmented button:last-child');
      await sleep(400);
      await cn.evaluate(`${q('.sheet')}.scrollTop = 0; true`);
      await cn.shot(`${DATE}-aw19-statisztika.png`);
    }
    await click(cn, '.trip-delete-all .mini-btn');
    await cn.waitFor(q('.delete-all-panel'), 3000, 'megerősítés');
    const confirmTxt = await cn.evaluate(text('.delete-all-panel > .label'));
    // AOS17: pipa nélkül azonnal és véglegesen (a minták is törlődnek)
    await click(cn, '.check-row:nth-of-type(2)');
    await click(cn, '.trip-delete-all .mini-btn.danger');
    await cn.waitFor(`!${q('.trip-row')}`, 5000, 'üres napló');
    const afterAll = await cn.evaluate(TRIPS_DB);
    check('AW19: „Összes törlése” megerősítéssel – a napló és a minták üresek', confirmTxt === 'Törlöd az összes utat?' && afterAll.trips.length === 0 && afterAll.samples.length === 0, JSON.stringify({ confirmTxt, trips: afterAll.trips.length }));
    check('nincs kezeletlen JS-kivétel (AW19 napló)', cr.logs.length === 0 && cf.logs.length === 0 && cn.logs.length === 0, `cr: ${cr.logs.join(' ; ')} | cf: ${cf.logs.join(' ; ')} | cn: ${cn.logs.join(' ; ')}`);
    await cn.close();
  }


  // ------------------------------------------------------------------
  // AW20: hőtérkép (személyes, közösségi), adatmegosztás, az út színezése
  // ------------------------------------------------------------------
  {
    const HEAT_STATE = `(() => { const d = document.querySelector('.mapboxgl-map')?.dataset.heat ?? ''; const [view, n, pts] = d.split(':'); return { view: view ?? '', n: Number(n ?? 0), pts: Number(pts ?? 0), raw: d }; })()`;
    const heatIs = (cond) => `(() => { const h = ${HEAT_STATE}; return ${cond}; })()`;

    // 1) mesterséges, több utas adat: a réteg, a mód-váltó, a zoom-függő összevonás
    const hs = await mk(SHOT);
    await hs.goto('/?navsim&heatSeed&panel=0');
    await hs.waitFor(MAP_READY, 60_000, 'térkép');
    await hs.waitFor(heatIs(`h.n > 0`), 60_000, 'hőtérkép-réteg');
    const h1 = await hs.evaluate(`(() => ({ h: ${HEAT_STATE}, sw: [...document.querySelectorAll('.heat-switch .segmented button')].map((b) => b.innerText.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')), legend: ${text('.heat-legend-text')} }))()`);
    check('AW20: ?heatSeed – a hőtérkép-réteg megvan az üres nézeten (Gyakoriság mód, pontok a látható területen)', h1.h.view === 'gyakorisag' && h1.h.n > 0, JSON.stringify(h1.h));
    check('AW20: a mód-váltó „Gyakoriság*” | „Átlagsebesség”, jelmagyarázattal („ritkán → gyakran”)', h1.sw.join('|') === 'Gyakoriság*|Átlagsebesség' && h1.legend === 'ritkán → gyakran', JSON.stringify(h1));
    if (!CHECK_ONLY) {
      await hs.evaluate(`window.__mapJump(47.497, 19.05, 12.9)`);
      await sleep(3500);
      await hs.shot(`${DATE}-aw20-hoterkep-gyakorisag.png`);
    }
    await click(hs, '.heat-switch .segmented button[aria-pressed="false"]');
    await hs.waitFor(heatIs(`h.view === 'atlagsebesseg'`), 10_000, 'átlagsebesség mód');
    const h2 = await hs.evaluate(`(() => ({ h: ${HEAT_STATE}, legend: ${text('.heat-legend-text')}, stored: JSON.parse(localStorage.getItem('settings:v1')).hoterkep_nezet }))()`);
    check('AW20: átlagsebesség módra váltva a réteg a másik skálán marad (zöld → piros jelmagyarázat), a választás tárolódik', h2.h.n > 0 && h2.legend === 'lassú → gyors' && h2.stored === 'atlagsebesseg', JSON.stringify(h2));
    if (!CHECK_ONLY) {
      await sleep(2500);
      await hs.shot(`${DATE}-aw20-hoterkep-atlagsebesseg.png`);
    }
    // AW24: vonalak minden zoomon: közelről és kizoomolva is csík (nincs felbontás-váltás, a sok vonal plafon alatt)
    await hs.evaluate(`window.__mapJump(47.5, 19.04, 14)`);
    await hs.waitFor(heatIs(`h.n > 0`), 15_000, 'közeli vonalak');
    const near = await hs.evaluate(HEAT_STATE);
    await hs.evaluate(`window.__mapJump(47.55, 18.5, 9)`);
    await hs.waitFor(heatIs(`h.n > 0 && h.pts !== ${near.pts}`), 15_000, 'távoli vonalak');
    const far = await hs.evaluate(HEAT_STATE);
    check('AW24: hőtérkép csíkokkal – közelről és kizoomolva is vonalak, a plafon alatt', near.n > 0 && far.n > 0 && far.n <= 6000, JSON.stringify({ near, far }));
    // közösségi mód: ugyanaz a mesterséges adat a heat_global-nak megfelelő sorokból (hálózat nélkül)
    await hs.close();
    const hc = await mk(SHOT);
    await hc.goto('/?navsim&heatSeed&heat=kozossegi&panel=0');
    await hc.waitFor(MAP_READY, 60_000, 'térkép');
    await hc.waitFor(heatIs(`h.n > 0`), 60_000, 'közösségi réteg');
    const hcs = await hc.evaluate(`(() => ({ h: ${HEAT_STATE}, mode: JSON.parse(localStorage.getItem('settings:v1')).hoterkep }))()`);
    check('AW20: közösségi mód – a réteg a közösségi sorokból rajzol (?heatSeed), a beállítás tárolódik', hcs.mode === 'kozossegi' && hcs.h.n > 0, JSON.stringify(hcs));
    await hc.close();

    // 2) „ki” mód és navigáció / mérés közben nincs réteg
    const ho = await mk(SHOT);
    await ho.goto('/?navsim&heatSeed&heat=ki&panel=0');
    await ho.waitFor(MAP_READY, 60_000, 'térkép');
    await sleep(2500);
    const off = await ho.evaluate(`(() => ({ raw: ${HEAT_STATE}.raw, sw: !!${q('.heat-switch')} }))()`);
    check('AW20: „Hőtérkép: ki” – nincs réteg és nincs mód-váltó', off.raw === '' && !off.sw, JSON.stringify(off));
    await ho.close();
    const hn = await mk(SHOT);
    await hn.goto('/?navsim&heatSeed&stage=nav&speed=1&panel=0');
    await hn.waitFor(MAP_READY, 60_000, 'térkép');
    await hn.waitFor(q('.nav-top'), 60_000, 'navigáció');
    await sleep(2500);
    const nv = await hn.evaluate(`(() => ({ raw: ${HEAT_STATE}.raw, sw: !!${q('.heat-switch')} }))()`);
    check('AW20: navigáció közben nincs hőtérkép-réteg (csak az üres nézeten és krúzingban)', nv.raw === '' && !nv.sw, JSON.stringify(nv));
    await hn.close();

    // 3) Beállítások: Hőtérkép ki / saját / közösségi + névtelen adatmegosztás (alapból KI)
    const hg = await mk(SHOT);
    await hg.goto('/?navsim&panel=0');
    await hg.waitFor(MAP_READY, 60_000, 'térkép');
    await click(hg, '.round-btn[aria-label="Beállítások"]');
    await hg.waitFor(q('[data-testid="heat-mode"]'), 10_000, 'hőtérkép-sor');
    const st = await hg.evaluate(`(() => { const m = ${q('[data-testid="heat-mode"]')}; const row = m.closest('.list-row'); const shareRow = [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('.label')?.innerText === 'Névtelen vezetési adatok megosztása'); const sw = shareRow?.querySelector('[role="switch"]'); return { modes: [...m.querySelectorAll('button')].map((b) => b.innerText.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')), hint: row.querySelector('.hint').innerText, share: sw?.getAttribute('aria-checked'), shareHint: shareRow?.querySelector('.hint').innerText ?? '' }; })()`);
    check('AW20: Beállítások – „Hőtérkép” Ki | Saját* | Közösségi, rövid magyarázattal', st.modes.join('|') === 'Ki|Saját*|Közösségi' && /névtelen/.test(st.hint), JSON.stringify(st));
    check('AW20 + AOS17: „Névtelen vezetési adatok megosztása” alapból BE, a leírás: mi megy fel (cella, áthaladás-szám, átlagsebesség, óra-sáv, hét napja) és mi nem (útvonal, pontos idő, azonosító, mentett helyek környéke, utak eleje / vége)', st.share === 'true' && /áthaladás-szám/.test(st.shareHint) && /Nem megy fel: útvonal, pontos idő, azonosító, a mentett helyek környéke, az utak eleje és vége/.test(st.shareHint), st.shareHint);
    await hg.evaluate(`(() => { const r = ${q('[data-testid="heat-mode"]')}.closest('.list-row'); r.scrollIntoView({ block: 'center' }); return true; })()`);
    if (!CHECK_ONLY) {
      await sleep(900);
      await hg.shot(`${DATE}-aw20-beallitasok-hoterkep.png`);
    }
    await click(hg, '[data-testid="heat-mode"] button:last-child');
    const stored = await hg.evaluate(`JSON.parse(localStorage.getItem('settings:v1')).hoterkep`);
    check('AW20: a Hőtérkép-választó („Közösségi”) a beállításba kerül', stored === 'kozossegi', stored);
    await hg.close();

    // 4) személyes hőtérkép a krúzing-út után: a `heat` tár (inkrementális), majd a réteg az üres nézeten
    const hk = await mk(SHOT);
    await hk.goto('/');
    await hk.waitFor(q('.mapboxgl-canvas'), 60_000, 'térkép');
    await hk.evaluate(CLEAR_TRIPS);
    await hk.goto('/?cruise&speed=60&panel=0');
    await hk.waitFor(MAP_READY, 60_000, 'térkép');
    const HEAT_DB = `(async () => {
      const db = await new Promise((res, rej) => { const o = indexedDB.open('atlagsebesseg-trips'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
      const all = (store) => new Promise((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
      const out = { trips: await all('trips'), samples: await all('samples'), heat: await all('heat'), heatTrips: await all('heatTrips'), tracks: await all('tracks'), v: db.version };
      db.close();
      return out;
    })()`;
    const hd = Date.now() + 120_000;
    let hdb = { trips: [], samples: [], heat: [], heatTrips: [], tracks: [], v: 0 };
    while (Date.now() < hd) {
      hdb = await hk.evaluate(HEAT_DB);
      if (hdb.heat.length > 0) break;
      await sleep(500);
    }
    const trip = hdb.trips[0];
    const passes = hdb.heat.reduce((n, c) => n + c.count, 0);
    check('AW20: a krúzing-út végén a személyes hőtérkép cellánként frissül (IndexedDB `heat`: h3 res 10, áthaladások, átlag, utolsó idő), az út megjelölve', hdb.v === 5 && !!trip && hdb.heat.length > 20 && hdb.heat.every((c) => /^8a[0-9a-f]{13}$/.test(c.h3) && c.count >= 1 && c.avgKmh > 0 && c.lastT > 0) && hdb.heatTrips.some((x) => x.id === trip.id), JSON.stringify({ v: hdb.v, cells: hdb.heat.length, passes, trips: hdb.heatTrips.length }));
    check('AW24: a krúzing-út végén az út vonala is elkészül (IndexedDB `tracks`; AW25: a saját rács-illesztővel a nyers pontokból, hálózat nélkül, a Map Matching nem hívódik)', hdb.tracks.some((t) => t.tripId === trip?.id) && hdb.tracks.filter((t) => t.tripId === trip?.id).every((t) => t.status === 'done' && t.matcher === 'grid' && t.lines.length >= 1 && t.lines.every((l) => l.matched)), JSON.stringify(hdb.tracks.map((t) => ({ s: t.status, m: t.matcher, l: t.lines.length }))));
    console.log(`  info: ${hdb.heat.length} cella / ${passes} áthaladás / ${hdb.samples.length} minta egy 17,7 km-es útból`);
    check('AW20: a megosztás alapból ki – a szimulátor-út nem kerül a feltöltési sorba, nincs hálózati írás', (await hk.evaluate(`localStorage.getItem('heat:segments:outbox:v1')`)) === null);
    await hk.close();
    const hp = await mk(SHOT);
    await hp.goto('/?navsim&panel=0&heat=sajat');
    await hp.waitFor(MAP_READY, 60_000, 'térkép');
    await hp.waitFor(heatIs(`h.n > 0`), 60_000, 'saját hőtérkép');
    const own = await hp.evaluate(HEAT_STATE);
    check('AW20: a krúzing után az üres nézeten a saját (valódi, helyi) hőtérkép látszik, mesterséges adat nélkül', own.n > 0, JSON.stringify(own));
    await hp.close();

    // 5) az út részlete: sebesség szerint színezett útvonal + jelmagyarázat
    const hdt = await mk(SHOT);
    await hdt.goto('/?navsim&panel=0&sheet=trips&tripOpen=first');
    await hdt.waitFor(`${q('.trip-map')} && window.__tripMapReady`, 60_000, 'út-térkép');
    await hdt.waitFor(q('[data-testid="trip-legend"]'), 15_000, 'jelmagyarázat');
    const tm = await hdt.evaluate(`(() => ({ runs: window.__tripMapRuns, kind: ${q('[data-testid="trip-legend"]')}.dataset.kind, txt: ${text('[data-testid="trip-legend"]')} }))()`);
    check('AW20: az út részletén a vonal a mért sebesség szerint színezett (több szakasz), abszolút skálával, ha a tábla-limit ismeretlen (krúzing)', tm.runs >= 2 && tm.kind === 'abs' && tm.txt === 'Sebesség: lassú → gyors', JSON.stringify(tm));
    if (!CHECK_ONLY) {
      await sleep(1500);
      await hdt.shot(`${DATE}-aw20-ut-reszlet-szinezett.png`);
    }
    check('nincs kezeletlen JS-kivétel (AW20 hőtérkép)', [hs, hc, ho, hn, hg, hk, hp, hdt].every((x) => x.logs.length === 0), [hs, hc, ho, hn, hg, hk, hp, hdt].flatMap((x) => x.logs).join(' | '));
    await hdt.close();

    // AOS16: az „Összes törlése” után a kirajzolt saját hőtérkép is azonnal ürül (nem csak a következő út végén)
    const hx = await mk(SHOT);
    await hx.goto('/?navsim&panel=0&heat=sajat&sheet=trips');
    await hx.waitFor(MAP_READY, 60_000, 'térkép');
    await hx.waitFor(heatIs(`h.n > 0`), 60_000, 'saját hőtérkép');
    await click(hx, '.trip-delete-all .mini-btn');
    await hx.waitFor(q('.trip-delete-all .mini-btn.danger'), 3000, 'megerősítés');
    // AOS17: a hőtérkép csak külön kérésre törlődik
    await click(hx, '.check-row');
    await click(hx, '.trip-delete-all .mini-btn.danger');
    await hx.waitFor(heatIs(`h.n === 0`), 15_000, 'üres hőtérkép');
    check('AOS16: „Összes törlése” után a saját hőtérkép azonnal üres', (await hx.evaluate(HEAT_STATE)).n === 0);
    await hx.close();
  }


  // ------------------------------------------------------------------
  // AW20-javítás: adatvédelmi zónák (mentett helyek körül), szürke cellák, Részletek lap
  // ------------------------------------------------------------------
  {
    const SAVED = JSON.stringify({ home: { id: 'home', name: 'Haza', address: '', lat: 47.4975, lon: 19.0545 }, work: { id: 'work', name: 'Munka', address: '', lat: 47.5136, lon: 19.0407 }, others: [] });
    const HEAT_STATE = `(() => { const d = document.querySelector('.mapboxgl-map')?.dataset.heat ?? ''; const [view, n, pts, grey] = d.split(':'); return { view: view ?? '', n: Number(n ?? 0), pts: Number(pts ?? 0), grey: Number(grey ?? 0), zones: Number(document.querySelector('.mapboxgl-map')?.dataset.zones ?? 0) }; })()`;
    const heatIs = (cond) => `(() => { const h = ${HEAT_STATE}; return ${cond}; })()`;
    const withPlaces = async (p, path) => {
      await p.goto(path);
      await p.evaluate(`localStorage.setItem('nav:saved:v1', ${JSON.stringify(SAVED)}); true`);
      await p.send('Page.navigate', { url: `${BASE}${path}` });
    };

    const z = await mk(SHOT);
    await withPlaces(z, '/?navsim&heatSeed&heat=sajat&panel=0');
    await z.waitFor(MAP_READY, 60_000, 'térkép');
    await z.waitFor(heatIs(`h.n > 0`), 60_000, 'hőtérkép');
    await z.evaluate(`window.__mapJump(47.497, 19.05, 12.9)`);
    await z.waitFor(heatIs(`h.grey > 0`), 20_000, 'szürke szakaszok');
    const g1 = await z.evaluate(HEAT_STATE);
    check('AW20j: a mentett hely körüli zóna cellái szürkén jelennek meg (nem színezve), a többi cella színezett', g1.grey > 0 && g1.n > 0 && g1.zones === 0, JSON.stringify(g1));
    if (!CHECK_ONLY) {
      await sleep(3500);
      await z.shot(`${DATE}-aw20j-szurke-cellak.png`);
    }
    // Beállítások: a zóna halvány körei látszanak; a mentett helyek alatt a 200 m / 500 m / 1 km választó (AOS18: alap 200 m)
    await click(z, '.round-btn[aria-label="Beállítások"]');
    await z.waitFor(q('.zone-picker'), 10_000, 'zóna-választó');
    await z.waitFor(heatIs(`h.zones === 2`), 10_000, 'zóna-körök');
    const zp = await z.evaluate(`(() => ({ pickers: [...document.querySelectorAll('.zone-picker')].map((e) => e.dataset.zone + ':' + [...e.querySelectorAll('button')].map((b) => b.innerText.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join('|')), h: ${HEAT_STATE} }))()`);
    check('AW20j: Beállítások – a zónák halvány körei a térképen (2 mentett hely), helyenként 200 m* | 500 m | 1 km választó (AOS18: alap 200 m)', zp.h.zones === 2 && zp.pickers.join(' ; ') === 'home:200 m*|500 m|1 km ; work:200 m*|500 m|1 km', JSON.stringify(zp));
    await z.evaluate(`document.querySelector('.zone-picker[data-zone="home"]').scrollIntoView({ block: 'center' }); true`);
    await z.evaluate(`[...document.querySelectorAll('.zone-picker[data-zone="home"] button')].find((b) => b.innerText.trim() === '1 km').click(); true`);
    await sleep(1800);
    const big = await z.evaluate(`(() => ({ grey: ${HEAT_STATE}.grey, stored: JSON.parse(localStorage.getItem('settings:v1')).zona_m }))()`);
    // AOS16: a kamera a zónára áll: a követés kikapcsol, a „Vissza a helyemre” gomb megjelenik (nem ragad a zónán)
    check('AOS16: zónára álláskor megjelenik a „Vissza a helyemre” gomb', await z.evaluate(`!!document.querySelector('.recenter')`));
    if (!CHECK_ONLY) await z.shot(`${DATE}-aw20j-zona-a-terkepen.png`);
    await z.evaluate(`[...document.querySelectorAll('.zone-picker[data-zone="home"] button')].find((b) => b.innerText.trim() === '200 m').click(); true`);
    await sleep(1800);
    const small = await z.evaluate(`(() => ({ grey: ${HEAT_STATE}.grey, stored: JSON.parse(localStorage.getItem('settings:v1')).zona_m }))()`);
    check('AW20j: a zóna sugara állítható és tárolódik (200 m / 1 km); nagyobb zónában több szürke cella', big.stored.home === 1000 && small.stored.home === 200 && big.grey > small.grey, JSON.stringify({ big, small }));
    // Részletek lap
    await z.evaluate(`document.querySelector('[data-testid="heat-details-row"]').scrollIntoView({ block: 'center' }); true`);
    await click(z, '[data-testid="heat-details-row"]');
    await z.waitFor(q('[data-testid="heat-details"]'), 10_000, 'Részletek lap');
    const dt = await z.evaluate(`(() => ({ title: ${text('.sheet-head .title')}, groups: [...document.querySelectorAll('.heat-details .group-label')].map((e) => e.textContent.trim()), body: document.querySelector('[data-testid="heat-details"]').textContent, pickers: document.querySelectorAll('.heat-details .zone-picker').length, zones: ${HEAT_STATE}.zones }))()`);
    check('AW20j: „Részletek” lap – mi megy fel / mi nem / védett zónák, a zónák beállítása helyenként, a körök látszanak', dt.title === 'Névtelen adatmegosztás' && dt.groups.join('|') === 'Ami felmegy|Ami nem megy fel|Védett zónák' && /óra-sáv/.test(dt.body) && /mentett helyek környéke/.test(dt.body) && /300 m/.test(dt.body) && dt.pickers === 2 && dt.zones === 2, JSON.stringify(dt).slice(0, 500));
    if (!CHECK_ONLY) {
      await sleep(1500);
      await z.shot(`${DATE}-aw20j-reszletek-lap.png`);
    }
    await z.evaluate(`document.querySelector('.sheet .icon-btn').click(); true`);
    await z.waitFor(q('[data-testid="heat-mode"]'), 10_000, 'vissza a Beállításokba');
    await z.evaluate(`document.querySelector('.sheet .icon-btn').click(); true`);
    await z.waitFor(heatIs(`h.zones === 0`), 10_000, 'zóna-körök eltűnnek');
    check('AW20j: a zóna-körök csak a Beállítások / Részletek nyitva tartása alatt látszanak', true);
    // a zónák és a mentett helyek csak helyben: a localStorage-ban vannak, a hálózati hívásba nem kerülnek (a kérés-logika: heatUpload.test.ts)
    const loc = await z.evaluate(`(() => ({ saved: !!localStorage.getItem('nav:saved:v1'), zona: !!JSON.parse(localStorage.getItem('settings:v1')).zona_m, outbox: localStorage.getItem('heat:segments:outbox:v1') }))()`);
    check('AW20j: a zónák (settings) és a mentett helyek a készülék tárolójában vannak; a feltöltési sor üres', loc.saved && loc.zona && loc.outbox === null, JSON.stringify(loc));
    // kizoomolva a zóna szakaszai szürkék maradnak
    await z.evaluate(`window.__mapJump(47.5, 19.04, 9.5)`);
    await z.waitFor(heatIs(`h.n > 0 && h.grey > 0`), 20_000, 'kizoomolva');
    const far = await z.evaluate(HEAT_STATE);
    check('AW24: kizoomolva is szürke a zóna és az út vége', far.grey > 0, JSON.stringify(far));
    check('nincs kezeletlen JS-kivétel (AW20j zónák)', z.logs.length === 0, z.logs.join(' | '));
    await z.close();

    // közösségi módban nincs szürke (mások aggregátuma)
    const zc = await mk(SHOT);
    await withPlaces(zc, '/?navsim&heatSeed&heat=kozossegi&panel=0');
    await zc.waitFor(MAP_READY, 60_000, 'térkép');
    await zc.waitFor(heatIs(`h.n > 0`), 60_000, 'közösségi réteg');
    const gc = await zc.evaluate(HEAT_STATE);
    check('AW20j: közösségi módban nincs szürke cella', gc.grey === 0 && gc.n > 0, JSON.stringify(gc));
    await zc.close();
  }

  // ------------------------------------------------------------------
  // AOS17: kezdőképernyő, Bejelentés (A5-ös méret, Térképhiba-választó), Beállítások (zöld, zóna 320 px-en), törlés 30 nappal
  // ------------------------------------------------------------------
  {
    const LANGS = ['hu', 'en', 'de', 'sk', 'cs', 'pl'];
    const size = (p, width, height = 844) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: CHECK_ONLY ? 1 : 3, mobile: true });
    const setLang = async (p, lang, path) => {
      await p.evaluate(`localStorage.setItem('lang:v1', '${lang}'); true`);
      await p.send('Page.navigate', { url: `${BASE}${path}` });
    };

    // a cím minden nyelven egy sorban, a képernyőn belül; 320 px-en is
    const st0 = await mk(SHOT);
    await st0.goto('/');
    await st0.waitFor(q('.start h1'), 30_000, 'kezdőképernyő');
    for (const width of [320, 390]) {
      await size(st0, width);
      for (const lang of LANGS) {
        await setLang(st0, lang, '/');
        await sleep(200);
        await st0.waitFor(q('.start h1'), 30_000, 'kezdőképernyő');
        await st0.evaluate(`document.fonts.ready.then(() => true)`);
        await sleep(150);
        const h = await st0.evaluate(`(() => { const e = ${q('.start h1')}; const r = e.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(e); const t = rg.getBoundingClientRect(); return { lines: Math.round(t.height / parseFloat(getComputedStyle(e).lineHeight)), right: t.right, vw: innerWidth, size: getComputedStyle(e).fontSize, text: e.innerText.trim() }; })()`);
        check(`AOS17: a cím egy sorban a ${width} px-es képernyőn belül (${lang}: ${h.text}, ${h.size})`, h.lines === 1 && h.right <= h.vw, JSON.stringify(h));
      }
    }
    if (!CHECK_ONLY) {
      await size(st0, 390);
      for (const lang of ['hu', 'de']) {
        await setLang(st0, lang, '/');
        await sleep(5000);
        await st0.shot(`${DATE}-aos17-web-kezdo-${lang}.png`);
      }
    }
    await st0.close();

    // Bejelentés: A5-ös méretek, nincs elválasztás, a felirat a csempén belül – minden nyelven, keskeny kijelzőn is
    // mozgó szimulátor: a jegyzet csak haladási iránnyal az alapszöveg (álló helyzetben az irány hiányáról szól)
    const rp = await mk(SHOT);
    await rp.goto('/?sim=jo&panel=0');
    await rp.waitFor(MAP_READY, 60_000, 'térkép');
    await rp.waitFor(q('button[aria-label="Bejelentés"]'), 30_000, 'Bejelentés gomb');
    await sleep(4000);
    const TILE = `(() => { const t = [...document.querySelectorAll('.sheet .tile')]; const sheet = ${q('.sheet')}.getBoundingClientRect(); return { n: t.length, h: Math.min(...t.map((x) => x.getBoundingClientRect().height)), ic: t.map((x) => x.querySelector('.ic').getBoundingClientRect().width), font: parseFloat(getComputedStyle(t[0]).fontSize), hyphens: getComputedStyle(t[0]).hyphens, spill: t.filter((x) => { const r = document.createRange(); r.selectNodeContents(x); const b = r.getBoundingClientRect(); const c = x.getBoundingClientRect(); return b.right > c.right || b.left < c.left; }).map((x) => x.innerText.trim()), inSheet: t.every((x) => x.getBoundingClientRect().right <= sheet.right && x.getBoundingClientRect().left >= sheet.left), cols: new Set(t.map((x) => Math.round(x.getBoundingClientRect().left))).size, wide: t.at(-1).getBoundingClientRect().width > t[0].getBoundingClientRect().width * 1.5, note: ${text('.sheet-note')} }; })()`;
    await click(rp, 'button[aria-label="Bejelentés"]');
    await rp.waitFor(q('.sheet .tiles'), 5000, 'bejelentés-menü');
    const a5 = await rp.evaluate(TILE);
    check('AOS17: Bejelentés – A5-ös méret: 2 oszlop, 76 px-es csempe, 44 px-es ikon, 18 px-es felirat, a kapu-tétel teljes szélességű, nincs elválasztás', a5.n === 9 && a5.cols === 2 && a5.h >= 76 && a5.ic.every((w) => w === 44) && a5.font === 18 && a5.wide && a5.hyphens !== 'auto' && a5.inSheet && a5.spill.length === 0, JSON.stringify(a5));
    check('AOS17: a lap alsó szövege szó szerint', a5.note === 'A jelenlegi helyed és haladási irányod kerül a bejelentésbe. Ideiglenes szakasz: a mérés végén a „Vége” gomb jelenti be a záró kaput.', a5.note);
    if (!CHECK_ONLY) await rp.shot(`${DATE}-aos17-web-bejelentes.png`);
    await rp.close();
    const rl = await mk('blank');
    await rl.goto('/?navsim&panel=0');
    await rl.waitFor(MAP_READY, 60_000, 'térkép');
    for (const width of [320, 375, 390, 430]) {
      await size(rl, width);
      for (const lang of LANGS) {
        await setLang(rl, lang, '/?navsim&panel=0');
        await rl.waitFor(MAP_READY, 60_000, 'térkép');
        await rl.waitFor(`document.querySelector('.round-btn')`, 10_000, 'gombok');
        const aria = JSON.parse(readFileSync(join(here, '..', '..', '..', 'packages/app-logic/src/i18n', `${lang}.json`), 'utf8'))['map.report'];
        await click(rl, `button[aria-label="${aria}"]`).catch(() => undefined);
        await rl.waitFor(q('.sheet .tiles'), 3000, 'menü').catch(() => undefined);
        const r = await rl.evaluate(`document.querySelector('.sheet .tiles') ? ${TILE} : null`);
        if (r) check(`AOS17: Bejelentés ${width} px, ${lang}: a feliratok a csempén belül, szótörés nélkül`, r.spill.length === 0 && r.inSheet, JSON.stringify(r.spill));
        else check(`AOS17: Bejelentés ${width} px, ${lang}: a menü megnyílik`, false);
      }
    }
    await rl.close();

    // Térképhiba: második választó, a küldött sor alkategóriával, az első koppintáskori helyről
    const me = await mk(SHOT);
    await me.goto('/?navsim&panel=0');
    await me.waitFor(MAP_READY, 60_000, 'térkép');
    await me.evaluate(`window.__rows = []; const f1 = window.fetch; window.fetch = (...a) => { const u = String(a[0]?.url ?? a[0]); if (/\\/rest\\/v1\\/reports/.test(u) && (a[1]?.method ?? 'GET') === 'POST') { window.__rows.push(JSON.parse(a[1].body)); return Promise.resolve(new Response(JSON.stringify([{ id: 'x1' }]), { status: 201, headers: { 'content-type': 'application/json' } })); } return f1(...a); }; true`);
    await click(me, 'button[aria-label="Bejelentés"]');
    await me.waitFor(q('.sheet .tiles'), 5000, 'bejelentés-menü');
    const tileBox = await me.evaluate(`(() => { const t = [...document.querySelectorAll('.sheet .tile')]; const x = t.find((e) => e.innerText.trim() === 'Térképhiba'); return { found: !!x, labels: t.map((e) => e.innerText.trim()) }; })()`);
    check('AOS17: a „Hibás szakasz” csempe neve „Térképhiba”', tileBox.found && !tileBox.labels.includes('Hibás szakasz'), tileBox.labels.join('|'));
    await me.evaluate(`[...document.querySelectorAll('.sheet .tile')].find((e) => e.innerText.trim() === 'Térképhiba').click(); true`);
    await me.waitFor(q('[data-testid="map-error-list"]'), 3000, 'Térképhiba-választó');
    const kinds = await me.evaluate(`[...document.querySelectorAll('[data-testid="map-error-list"] button')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
    check('AOS17: a második választó hat tétele a kért sorrendben', kinds.join('|') === 'Rossz szakaszhatár kezdő/záró kapu rossz helyen|Rossz sebességhatár|Nem létezik ez a szakasz|Hiányzó szakasz|Rossz kamera-pozíció|Egyéb', kinds.join('|'));
    if (!CHECK_ONLY) await me.shot(`${DATE}-aos17-web-terkephiba.png`);
    await click(me, '[data-kind="kamera"]');
    await me.waitFor(`window.__rows.length === 1 && !${q('.sheet')}`, 15000, 'elküldve').catch(() => undefined);
    const row = await me.evaluate(`window.__rows[0]?.[0] ?? window.__rows[0] ?? null`);
    check('AOS17: a sor `szakasz_hiba` típussal és `kamera` alkategóriával megy', row?.type === 'szakasz_hiba' && row?.subtype === 'kamera', JSON.stringify(row));
    await me.close();

    // Beállítások: zöld jelölés, 320 px-en a zóna-választó, nincs vonal a megosztás és a Részletek között
    const places = JSON.stringify({ home: { lat: 47.5, lon: 19.04, name: 'Budapest, Kossuth tér 1.', address: '' }, work: { lat: 47.45, lon: 19, name: 'Budaörs, Szabadság út 117.', address: '' }, others: [] });
    const se = await mk(SHOT);
    await se.goto('/?navsim&panel=0');
    await se.evaluate(`localStorage.setItem('nav:saved:v1', ${JSON.stringify(places)}); true`);
    await size(se, 320, 700);
    await se.send('Page.navigate', { url: `${BASE}/?navsim&panel=0&sheet=settings` });
    await se.waitFor(q('.zone-picker'), 30_000, 'zóna-választó');
    const seg = await se.evaluate(`(() => [...document.querySelectorAll('.zone-picker')].map((z) => { const s = z.querySelector('.segmented').getBoundingClientRect(); const row = z.closest('.list-row').getBoundingClientRect(); const b = [...z.querySelectorAll('button')].map((x) => x.getBoundingClientRect()); return { inside: b.every((x) => x.left >= s.left && x.right <= s.right + 0.5), inRow: s.right <= row.right && s.left >= row.left, equal: Math.abs(b[0].width - b[2].width) < 1, oneLine: new Set(b.map((x) => Math.round(x.top))).size === 1 }; }))()`);
    check('AOS17, AOS18: 320 px-en a zóna-szegmensek (az „1 km” is) a háttéren és a soron belül, egy sorban (a választó a tartalma széles, balra zárt)', seg.length === 2 && seg.every((x) => x.inside && x.inRow && x.oneLine), JSON.stringify(seg));
    const look = await se.evaluate(`(() => { const on = ${q('.segmented button[aria-pressed="true"]')}; const sw = ${q('.switch[aria-checked="true"]')}; const share = ${q('[data-testid="heat-details-row"]')}.previousElementSibling; return { seg: getComputedStyle(on).backgroundColor, sw: getComputedStyle(sw).backgroundColor, shareLine: getComputedStyle(share).borderBottomWidth, shareOn: share.querySelector('.switch').getAttribute('aria-checked'), other: getComputedStyle(${q('.switch')}.closest('.list-row')).borderBottomWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    check('AOS17: a kapcsoló zöld, a kiválasztott szegmens fehér (mint eddig a weben)', look.sw === 'rgb(46, 229, 157)' && look.seg === 'rgb(244, 246, 250)', JSON.stringify(look));
    check('AOS17: a megosztás alapból BE, és a sora meg a Részletek között nincs vonal (a többi sor között van)', look.shareOn === 'true' && look.shareLine === '0px' && look.other === '1px' && !look.pageOverflow, JSON.stringify(look));
    await size(se, 390);
    if (!CHECK_ONLY) {
      await sleep(600);
      await se.shot(`${DATE}-aos17-web-beallitasok.png`);
      await se.evaluate(`document.querySelector('.zone-picker').scrollIntoView({ block: 'center' }); true`);
      await sleep(400);
      await se.shot(`${DATE}-aos17-web-beallitasok-zona.png`);
    }
    await se.close();

    // migráció: a régi tárolt KI egyszer BE-re vált, utána a kikapcsolás megmarad
    const mg = await mk('blank');
    await mg.goto('/?navsim&panel=0&sheet=settings', { adatmegosztas: false });
    await mg.waitFor(q('[data-testid="heat-details-row"]'), 30_000, 'Beállítások');
    const SHARE = `${q('[data-testid="heat-details-row"]')}.previousElementSibling.querySelector('.switch')`;
    const m1 = await mg.evaluate(`${SHARE}.getAttribute('aria-checked')`);
    await mg.evaluate(`${SHARE}.click(); true`);
    await sleep(200);
    await mg.send('Page.reload');
    await sleep(300);
    await mg.waitFor(q('[data-testid="heat-details-row"]'), 30_000, 'Beállítások 2');
    const m2 = await mg.evaluate(`${SHARE}.getAttribute('aria-checked')`);
    check('AOS17: egyszeri migráció – a régi KI → BE, a felhasználó KI-je újratöltve is megmarad', m1 === 'true' && m2 === 'false', JSON.stringify({ m1, m2 }));
    await mg.close();

    // törlés: külön kérdés a hőtérképről, 30 nap alapból; visszaállítás a Beállításokból
    const SEED = `new Promise((res, rej) => { const o = indexedDB.open('atlagsebesseg-trips'); o.onerror = () => rej(o.error); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['trips', 'samples', 'heat', 'heatTrips', 'trashTrips', 'trashHeat', 'trashHeatTrips'], 'readwrite'); for (const s of ['trips', 'samples', 'heat', 'heatTrips', 'trashTrips', 'trashHeat', 'trashHeatTrips']) tx.objectStore(s).clear(); const t0 = Date.now() - 3600000; tx.objectStore('trips').put({ id: 'aos17', startedAt: t0, endedAt: t0 + 600000, distanceM: 5000, movingS: 600, idleS: 0, maxKmh: 60, turns: { left: 0, right: 0, uTurn: 0 }, dirChanges: { left: 0, right: 0, uTurn: 0 }, reroutes: 0, measurements: [], jamS: 0, destination: null, path: [[[19.04, 47.5], [19.05, 47.5]]], samples: 1 }); tx.objectStore('samples').add({ tripId: 'aos17', t: t0, lat: 47.5, lon: 19.04, speedKmh: 40, heading: 0, accuracy: 5, h3: '8a1e03785377fff' }); tx.objectStore('heat').put({ h3: '8a1e03785377fff', count: 2, avgKmh: 40, lastT: t0 }); tx.objectStore('heatTrips').put({ id: 'aos17' }); tx.oncomplete = () => { db.close(); res(true); }; }; })`;
    const COUNTS = `new Promise((res, rej) => { const o = indexedDB.open('atlagsebesseg-trips'); o.onerror = () => rej(o.error); o.onsuccess = () => { const db = o.result; const names = ['trips', 'samples', 'heat', 'trashTrips', 'trashHeat']; const tx = db.transaction(names); const out = {}; for (const n of names) tx.objectStore(n).count().onsuccess = (e) => (out[n] = e.target.result); tx.oncomplete = () => { db.close(); res(out); }; }; })`;
    const openLog = async (p) => {
      await p.send('Page.navigate', { url: `${BASE}/?navsim&panel=0&sheet=trips` });
      await p.waitFor(q('.trip-delete-all .mini-btn'), 30_000, 'napló');
      await click(p, '.trip-delete-all .mini-btn');
      await p.waitFor(q('.delete-all-panel'), 3000, 'párbeszéd');
    };
    const dl = await mk(SHOT);
    await dl.goto('/?navsim&panel=0&sheet=settings');
    await dl.waitFor(q('.sheet'), 30_000, 'lap');
    await dl.evaluate(SEED);
    await openLog(dl);
    const dialog = await dl.evaluate(`[...document.querySelectorAll('.check-row')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim() + ':' + c.getAttribute('aria-checked'))`);
    check('AOS17: a párbeszéd külön kérdezi a hőtérképet (alapból nem), a 30 nap alapból bepipálva', /hőtérképet is törlöm:false$/.test(dialog[0]) && /^30 napig visszaállítható.*:true$/.test(dialog[1]), dialog.join(' | '));
    if (!CHECK_ONLY) {
      await dl.evaluate(`document.querySelector('.delete-all-panel').scrollIntoView({ block: 'center' }); true`);
      await sleep(400);
      await dl.shot(`${DATE}-aos17-web-torles.png`);
    }
    await click(dl, '.delete-all-panel .mini-btn.danger');
    await sleep(500);
    const c1 = await dl.evaluate(COUNTS);
    check('AOS17: alapértékekkel az utak a kukába, a hőtérkép és a minták maradnak', c1.trips === 0 && c1.trashTrips === 1 && c1.heat === 1 && c1.trashHeat === 0 && c1.samples === 1, JSON.stringify(c1));
    await dl.send('Page.navigate', { url: `${BASE}/?navsim&panel=0&sheet=settings` });
    await dl.waitFor(q('[data-testid="trash-restore"]'), 30_000, 'visszaállítás sor');
    const rowText = await dl.evaluate(text('[data-testid="trash-restore"]'));
    check('AOS17: Beállítások – „Törölt adatok visszaállítása” a lejárattal', /^Törölt adatok visszaállítása Lejárat: /.test(rowText), rowText);
    if (!CHECK_ONLY) {
      await dl.evaluate(`document.querySelector('[data-testid="trash-restore"]').scrollIntoView({ block: 'center' }); true`);
      await sleep(400);
      await dl.shot(`${DATE}-aos17-web-visszaallitas.png`);
    }
    await click(dl, '[data-testid="trash-restore"]');
    await dl.waitFor(`!${q('[data-testid="trash-restore"]')}`, 5000, 'sor eltűnt').catch(() => undefined);
    const c2 = await dl.evaluate(COUNTS);
    check('AOS17: visszaállítás után az út visszajön, a kuka üres, a sor eltűnik', c2.trips === 1 && c2.trashTrips === 0 && !(await dl.evaluate(q('[data-testid="trash-restore"]'))), JSON.stringify(c2));
    // pipa + hőtérkép: kukába és vissza, súlyozott összevonással; pipa nélkül végleges
    await openLog(dl);
    await click(dl, '.check-row');
    await click(dl, '.delete-all-panel .mini-btn.danger');
    await sleep(500);
    const c3 = await dl.evaluate(COUNTS);
    check('AOS17: külön kérésre a hőtérkép is a kukába kerül', c3.heat === 0 && c3.trashHeat === 1 && c3.trashTrips === 1, JSON.stringify(c3));
    await dl.evaluate(SEED);
    await openLog(dl);
    await click(dl, '.check-row:nth-of-type(2)');
    const finalHint = await dl.evaluate(text('.check-row:nth-of-type(2) .hint'));
    await click(dl, '.check-row');
    await click(dl, '.delete-all-panel .mini-btn.danger');
    await sleep(500);
    const c4 = await dl.evaluate(COUNTS);
    await dl.send('Page.navigate', { url: `${BASE}/?navsim&panel=0&sheet=settings` });
    await dl.waitFor(q('.trips-entry'), 30_000, 'Beállítások');
    await sleep(500);
    check('AOS17: pipa nélkül azonnal és véglegesen – nincs kuka, nincs visszaállítás sor', Object.values(c4).every((n) => n === 0) && /véglegesen/.test(finalHint) && !(await dl.evaluate(q('[data-testid="trash-restore"]'))), JSON.stringify({ c4, finalHint }));
    await dl.close();
  }

  // ------------------------------------------------------------------
  // 3. marketing-képernyőképek (1×-es lejátszás, szimulátor-panel nélkül)
  // ------------------------------------------------------------------
  if (!CHECK_ONLY) {
    const info = await mk('photo');
    await info.goto('/?navsim&panel=0');
    await info.waitFor(`window.__navSim`, 60_000, 'szimulátor-adat');
    const { windows, length } = await info.evaluate(`window.__navSim`);
    await info.close();
    console.log(`  ablakok: ${windows.join(', ')} / ${length}`);

    // A8d, AW11: az alternatíva a színes és a visszafogott térképen (útvonalválasztó); éjjel éjjeli szín + világos kontúr,
    // nappal (Színes: alkonyi fény, Visszafogott: nappali fény) a napszak szerint (?sunAt, AW16)
    for (const terkep of ['szines', 'visszafogott']) {
      for (const [sunAt, suffix] of [[SUN.ejjel, ''], [SUN.nappal, '-nappal']]) {
        const v = await mk('photo');
        await v.goto(`/?navsim&stage=picker&speed=1&panel=0&sunAt=${sunAt}`, { terkep });
        await v.waitFor(MAP_READY, 60_000, 'térkép');
        await v.waitFor(q('.route-label'), 30_000, 'alternatíva-címke');
        await sleep(4000);
        await v.shot(`${DATE}-nav-alternativa-${terkep}${suffix}.png`);
        await v.close();
      }
    }

    // navigáció felső kártyával (az 1. ablak eleje, a belvárosból indulás)
    const a = await mk('photo');
    await a.goto('/?navsim&stage=nav&speed=1&at=20&panel=0');
    await a.waitFor(MAP_READY, 60_000, 'térkép');
    await a.waitFor(q('.nav-top'), 30_000, 'felső kártya');
    await sleep(4500);
    await a.shot(`${DATE}-nav-felso-kartya.png`);
    await a.close();

    // szakasz-közeledés: a B ablakban a szakasz előtt ~1,5 km-re
    const b = await mk('photo');
    await b.goto(`/?navsim&stage=nav&speed=1&at=${windows[1] + 55}&panel=0`);
    await b.waitFor(MAP_READY, 60_000, 'térkép');
    await b.waitFor(`${q('.nav-badge')} && /Szakaszellenőrzés/.test(${q('.nav-badge')}.innerText)`, 60_000, 'szakasz-jelzés');
    await sleep(4500);
    await b.shot(`${DATE}-nav-szakasz-kozeledes.png`);
    await b.close();

    // mérés közbeni összevont nézet: a szakaszon, gyors szakaszban (Túl gyors)
    const m = await mk('photo');
    await m.goto(`/?navsim&stage=nav&speed=1&at=${windows[1] + 95 + 22}&panel=0`);
    await m.waitFor(MAP_READY, 60_000, 'térkép');
    await m.waitFor(q('.nav-strip'), 60_000, 'összevont sáv');
    await sleep(4500);
    await m.shot(`${DATE}-nav-meres-kozben.png`);
    await m.close();

    // közeli kamera: a borostyán felső sáv (a B ablakban, a szakasz után)
    const k = await mk('photo');
    await k.goto(`/?navsim&stage=nav&speed=1&at=${windows[1] + 245}&alt=maybe&panel=0`);
    await k.waitFor(MAP_READY, 60_000, 'térkép');
    await k.waitFor(`${q('.nav-top')}?.dataset.camera === 'true'`, 60_000, 'kamera-közeledés');
    await sleep(2500);
    await k.shot(`${DATE}-nav-kamera-kozel.png`);
    await k.close();

    // gyorsabb út ajánlat: 4×-es lejátszás, amíg az ajánlat meg nem jelenik
    const o = await mk('photo');
    await o.goto('/?navsim&stage=nav&speed=4&panel=0');
    await o.waitFor(MAP_READY, 60_000, 'térkép');
    await o.waitFor(q('.nav-offer'), 180_000, 'ajánlat');
    await sleep(1200);
    await o.shot(`${DATE}-nav-gyorsabb-ut.png`);
    await o.close();
  }
  // ------------------------------------------------------------------
  // AW22: Veszély-csempe, Fiók kártya (a szimulátor hálózat nélkül: `?account=`), névlépés, ajánlat, térkép-nyelv
  // ------------------------------------------------------------------
  {
    const hz = await mk();
    await hz.goto('/?navsim&panel=0&heat=ki&speed=7');
    await hz.waitFor(q('.card.compact'), 60_000, 'alapkártya');
    await click(hz, 'button[aria-label="Bejelentés"]');
    await hz.waitFor(q('.sheet .tiles'), 10_000, 'menü');
    const before = await hz.evaluate(`(() => { const t = [...document.querySelectorAll('.tile')].find((x) => /Veszély/.test(x.innerText)); const r = t?.getBoundingClientRect(); return t ? { h: r.height, w: r.width, i: [...document.querySelectorAll('.tile')].indexOf(t), akadaly: /Akadály/.test(document.body.innerText) } : null; })()`);
    check('AW22: az „Akadály” csempe „Veszély”, a mérete és a helye változatlan (76 px, a 4. csempe)', before && before.h === 76 && before.i === 3 && !before.akadaly, JSON.stringify(before));
    await hz.evaluate(`[...document.querySelectorAll('.tile')][3].click(); true`);
    await hz.waitFor(q('[data-testid="hazard-list"]'), 10_000, 'altípus-választó');
    const kinds = await hz.evaluate(`({ title: ${text('.sheet-head .title')}, rows: [...document.querySelectorAll('[data-testid="hazard-list"] .label')].map((x) => x.innerText), ids: [...document.querySelectorAll('[data-testid="hazard-list"] [data-kind]')].map((x) => x.dataset.kind) })`);
    check('AW22: a Veszély altípus-választója: Tárgy az úton · Kátyú · Álló jármű', kinds.title === 'Veszély' && kinds.rows.join('|') === 'Tárgy az úton|Kátyú|Álló jármű' && kinds.ids.join() === 'targy,katyu,allo_jarmu', JSON.stringify(kinds));
    await hz.close();

    const acc = async (query, width = 390) => {
      const p = await mk();
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await p.goto(`/?navsim&panel=0&heat=ki&speed=7&sheet=settings${query}`);
      await p.waitFor(q('[data-testid="account-card"]'), 60_000, 'Fiók kártya');
      return p;
    };
    const overflow = `(() => { const c = ${q('[data-testid="account-card"]')}; const sheet = ${q('.sheet')}; const bad = [...c.querySelectorAll('*:not(input[type="file"])')].filter((e) => e.getBoundingClientRect().right > sheet.getBoundingClientRect().right + 0.5 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName); return bad; })()`;
    for (const width of [320, 390, 430]) {
      const out = await acc('', width);
      const m = await out.evaluate(`(() => { const a = ${q('[data-testid="account-apple"]')}.getBoundingClientRect(); const g = ${q('[data-testid="account-google"]')}.getBoundingClientRect(); const e = ${q('[data-testid="account-email"]')}.getBoundingClientRect(); const first = ${q('.sheet .group-label')}.innerText; return { first, appleH: a.height, googleH: g.height, below: g.top >= a.bottom, sameRow: g.top === e.top, smaller: g.height < a.height, cs: getComputedStyle(${q('[data-testid="account-apple"]')}).backgroundColor, overflow: ${overflow} }; })()`);
      check(`AW22: ${width} px: kijelentkezve a lap tetején a Fiók kártya, nagy Apple-gomb, alatta kisebben a Google és az e-mail, semmi nem lóg ki`, m.first === 'FIÓK' && m.below && m.sameRow && m.smaller && m.appleH >= 56 && m.cs === 'rgb(255, 255, 255)' && m.overflow.length === 0, JSON.stringify(m));
      await out.close();
    }
    const off = await acc('&account=off');
    const offM = await off.evaluate(`({ note: !!${q('[data-testid="account-not-configured"]')}, apple: ${q('[data-testid="account-apple"]')}.disabled, google: ${q('[data-testid="account-google"]')}.disabled, email: ${q('[data-testid="account-email"]')}.disabled, err: !!${q('.account-error')} })`);
    check('AW22: be nem állított Apple/Google: tiszta felirat, nem hiba; az e-mail működik', offM.note && offM.apple && offM.google && !offM.email && !offM.err, JSON.stringify(offM));
    await click(off, '[data-testid="account-email"]');
    await off.waitFor(q('.account-email-form input'), 5000, 'e-mail mező');
    check('AW22: az e-mailhez csak cím kell, jelszó nincs (magic link)', await off.evaluate(`!${q('input[type="password"]')} && ${q('[data-testid="account-email-send"]')}.disabled`));
    await off.close();
    const sent = await acc('&account=sent');
    check('AW22: elküldött link visszajelzése', await sent.evaluate(`/kristof@example\.com/.test(${text('[data-testid="account-email-sent"]')})`));
    await sent.close();
    for (const width of [320, 390, 430]) {
      const inn = await acc('&account=in', width);
      const m = await inn.evaluate(`({ top: ${text('[data-testid="account-card"]')}, sync: /Szinkronizálva/.test(document.querySelector('.sheet').innerText), avatar: !!${q('[data-testid="account-avatar"]')}, hint: ${text('[data-testid="name-hint"]')}, backup: ${q('[data-testid="account-backup"]')}?.getAttribute('aria-checked'), privacy: ${text('[data-testid="privacy-group"]')}, last: ${q('.sheet-body, .sheet')}.querySelector('[data-testid="account-signout"]') !== null, overflow: ${overflow} })`);
      check(`AW24: ${width} px: a Beállítások tetején profilkép, név és e-mail; nincs szinkron-sor; a felhős mentés alapból BE és a fiók törlése az Adatvédelem blokkban; a kijelentkezés a lap alján`, /kristof@example\.com/.test(m.top) && m.avatar && !m.sync && /^Így köszönt az app induláskor: »Szia, indulhatunk!«$/.test(m.hint) && m.backup === 'true' && /Fiók törlése/.test(m.privacy) && !/Kijelentkezés/.test(m.top) && m.last && m.overflow.length === 0, JSON.stringify(m));
      if (width === 390) {
        await click(inn, '[data-testid="account-delete"]');
        await inn.waitFor(q('[data-testid="account-delete-panel"]'), 5000, 'megerősítés');
        check('AW22: a fiók törlése megerősítést kér, és kimondja, hogy a névtelen közösségi szakaszok maradnak', await inn.evaluate(`/közösségi hőtérképbe már névtelenül bekerült útszakaszok megmaradnak/.test(${text('[data-testid="account-delete-panel"]')})`));
      }
      await inn.close();
    }
    const ns = await mk();
    await ns.goto('/?navsim&panel=0&heat=ki&speed=7&nameStep=Anna');
    await ns.waitFor(q('[data-testid="name-step"]'), 60_000, 'névlépés');
    const nsv = await ns.evaluate(`({ value: ${q('[data-testid="name-step"] input')}.value, title: ${text('.sheet-head .title')} })`);
    check('AW22: „Így szólítsunk?” a keresztnévvel kitöltve, átírható', nsv.value === 'Anna' && nsv.title === 'Így szólítsunk?', JSON.stringify(nsv));
    await click(ns, '[data-testid="name-skip"]');
    await ns.waitFor(`!${q('[data-testid="name-step"]')}`, 5000, 'kihagyás');
    await ns.close();
    const ne = await mk();
    await ne.goto('/?navsim&panel=0&heat=ki&speed=7&nameStep=');
    await ne.waitFor(q('[data-testid="name-step"]'), 60_000, 'névlépés e-mailnél');
    check('AW22: e-mailes belépésnél a mező üres, a mentés tiltott', await ne.evaluate(`${q('[data-testid="name-step"] input')}.value === '' && ${q('[data-testid="name-save"]')}.disabled`));
    await ne.close();
    const nu = await mk();
    await nu.goto('/?navsim&panel=0&heat=ki&speed=7&nudge');
    await nu.waitFor(q('[data-testid="account-nudge"]'), 60_000, 'ajánlat');
    await click(nu, '[data-testid="nudge-signin"]');
    await nu.waitFor(q('[data-testid="account-card"]'), 5000, 'Beállítások');
    check('AW22: az ajánlatról a Fiók kártyára jutunk, és az ajánlat eltűnik', await nu.evaluate(`!${q('[data-testid="account-nudge"]')}`));
    await nu.close();
    const lm = await mk(REAL);
    await lm.goto('/?navsim&panel=0&heat=ki&speed=7&sheet=settings');
    await lm.waitFor(MAP_READY, 60_000, 'térkép');
    const lang0 = await lm.evaluate(`document.querySelector('.mapboxgl-map, [data-language]')?.dataset.language`);
    await lm.evaluate(`(() => { const s = ${q('select[aria-label="Nyelv"]')}; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'de'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(400);
    const lang1 = await lm.evaluate(`document.querySelector('[data-language]')?.dataset.language`);
    check('AW22: a térkép feliratainak nyelve az app nyelve, nyelvváltáskor azonnal', lang0 === 'hu' && lang1 === 'de', JSON.stringify({ lang0, lang1 }));
    await lm.close();
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
