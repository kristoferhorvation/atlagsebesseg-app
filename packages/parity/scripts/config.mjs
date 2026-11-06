// A paritás-harness közös beállításai (AOS18): eszközök, azonos fixtúra-állapotok a webre és az iOS-re.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..', '..');
export const OUT = join(ROOT, 'docs', 'parity');
export const WORK = join(ROOT, 'packages', 'parity', '.work');
export const WEB_BASE = process.env.PARITY_BASE ?? 'http://localhost:5199';
export const BUNDLE = 'hu.atlagsebesseg.app';
/** A web és az iOS órája a képek alatt: az érkezési idők így azonosak. */
export const FIXED_NOW_MS = Date.parse('2026-11-03T12:00:00+01:00');
export const TIME_ZONE = 'Europe/Budapest';

/** A három méret (CLAUDE.md › Három képernyőméret): pontos pt-méret, DPR és biztonsági zóna, mint a szimulátoron. */
export const DEVICES = {
  se: { udid: '5BA81420-639C-4EF9-9EE2-D1BFAD92272B', name: 'iPhone SE (3rd generation)', w: 375, h: 667, dpr: 2, top: 20, bottom: 0 },
  pro: { udid: '784E358E-250A-4F57-B9DC-31FB9F6E524A', name: 'iPhone 17 Pro', w: 402, h: 874, dpr: 3, top: 62, bottom: 34 },
  max: { udid: '993EFD1C-8EF5-47D6-B5AC-404CC5A90AD5', name: 'iPhone 17 Pro Max', w: 440, h: 956, dpr: 3, top: 62, bottom: 34 },
};

/** A mentett helyek mindkét platformon (a web localStorage-ból, az iOS `-simPlaces YES`-ből ugyanezt kapja). */
export const SAVED_PLACES = {
  home: { id: 'sim-home', name: 'Haza', address: '', lat: 47.5056, lon: 19.0476 },
  work: { id: 'sim-work', name: 'Munka', address: '', lat: 47.4975, lon: 19.0545 },
  others: [],
};

const NAV = ['-sim', 'navsim', '-simPanel', 'NO'];
const HEAT_OFF = ['-heat', 'ki'];

/**
 * Az állapotok: `web` az URL + a kattintások; `ios` az indítási argumentumok. A `speed` a webes lejátszás ütemét adja, de a
 * harness elnyeli a lejátszó időzítőjét (`speed=7` / `speed=12`), így mindkét platform pontosan a kért mintán áll.
 * `ready`: CSS-szelektor, amit a weben meg kell várni. `mask`: webes szelektorok, amelyek szándékos platform-eltérések.
 */
export const STATES = [
  { id: 'start', web: { path: '/', ready: '.start h1', mask: ['.start ul li:nth-child(3)'] }, ios: [] },
  { id: 'ures', web: { path: '/?navsim&panel=0&heat=ki&speed=7', ready: '.card.compact' }, ios: [...NAV, ...HEAT_OFF] },
  { id: 'hoterkep', web: { path: '/?navsim&panel=0&heatSeed&heat=sajat&heatView=gyakorisag&speed=7', ready: '.heat-switch' }, ios: [...NAV, '-heatSeed', 'YES', '-heat', 'sajat', '-heatView', 'gyakorisag'] },
  { id: 'krusing', web: { path: '/?cruise&panel=0&heat=ki&speed=7&at=300', ready: '.cruise-card[data-kind="full"]' }, ios: ['-cruise', 'YES', '-simPanel', 'NO', '-simAt', '300', ...HEAT_OFF] },
  // AW24: a krúzing-kártya három állapota rögzített mintaadattal
  { id: 'krusing-kartya', web: { path: '/?navsim&panel=0&heat=ki&speed=7&cruiseDemo=full', ready: '.cruise-card[data-kind="full"]' }, ios: [...NAV, ...HEAT_OFF, '-cruiseDemo', 'full'] },
  { id: 'krusing-kesz', web: { path: '/?navsim&panel=0&heat=ki&speed=7&cruiseDemo=ready', ready: '.cruise-card[data-kind="ready"]' }, ios: [...NAV, ...HEAT_OFF, '-cruiseDemo', 'ready'] },
  { id: 'krusing-sav', web: { path: '/?navsim&panel=0&heat=ki&speed=7&cruiseDemo=strip', ready: '.cruise-card[data-kind="strip"]' }, ios: [...NAV, ...HEAT_OFF, '-cruiseDemo', 'strip'] },
  { id: 'vissza', web: { path: '/?navsim&panel=0&heat=ki&speed=7', ready: '.card.compact', recenter: true }, ios: [...NAV, ...HEAT_OFF, '-parityNoFollow', 'YES'] },
  // AOS18-javítás: a „Vissza a helyemre” táblával is ugyanott (a gombsor jobb szélén)
  { id: 'vissza-nav', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=60', ready: '.nav-top', recenter: true }, ios: [...NAV, '-navStage', 'nav', '-simAt', '60', '-parityNoFollow', 'YES'] },
  // AW23: a felső gombsor mind a négy kombinációja, navigációban és azon kívül (az alsó sor nem mozdul)
  { id: 'mini-nav', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=60', ready: '.nav-top', mini: true }, ios: [...NAV, '-navStage', 'nav', '-simAt', '60', '-manual', '0', '-manualMini', 'YES'] },
  { id: 'mini-vissza-nav', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=60', ready: '.nav-top', mini: true, recenter: true }, ios: [...NAV, '-navStage', 'nav', '-simAt', '60', '-manual', '0', '-manualMini', 'YES', '-parityNoFollow', 'YES'] },
  { id: 'mini-ures', web: { path: '/?navsim&panel=0&heat=ki&speed=7&miniAlways', ready: '.card.compact', mini: true }, ios: [...NAV, ...HEAT_OFF, '-manual', '0', '-manualMini', 'YES', '-miniAlways', 'YES'] },
  { id: 'mini-vissza-ures', web: { path: '/?navsim&panel=0&heat=ki&speed=7&miniAlways', ready: '.card.compact', mini: true, recenter: true }, ios: [...NAV, ...HEAT_OFF, '-manual', '0', '-manualMini', 'YES', '-miniAlways', 'YES', '-parityNoFollow', 'YES'] },
  { id: 'kozeledik', web: { path: '/?sim=jo&route=0&speed=12&seek=0.15&panel=0&heat=ki', ready: '.hud > .card[aria-label="Mérőszakasz közeleg"]' }, ios: ['-sim', 'jo', '-simPanel', 'NO', '-simSeek', '0.15', ...HEAT_OFF] },
  { id: 'meres-jo', web: { path: '/?sim=jo&route=0&speed=12&seek=0.5&panel=0&heat=ki', ready: '.hud > .card .hero' }, ios: ['-sim', 'jo', '-simPanel', 'NO', '-simSeek', '0.5', ...HEAT_OFF] },
  { id: 'meres-lassit', web: { path: '/?sim=lassit&route=0&speed=12&seek=0.5&panel=0&heat=ki', ready: '.slowdown[data-show="true"]' }, ios: ['-sim', 'lassit', '-simPanel', 'NO', '-simSeek', '0.5', ...HEAT_OFF] },
  { id: 'eredmeny', web: { path: '/?sim=jo&route=0&speed=12&seek=0.97&panel=0&heat=ki', ready: '.hud > .card[aria-label="Szakasz vége"]' }, ios: ['-sim', 'jo', '-simPanel', 'NO', '-simSeek', '0.97', ...HEAT_OFF] },
  { id: 'kezi', web: { path: '/?navsim&panel=0&heat=ki&speed=7', ready: '.card.compact', click: 'button[aria-label="Kézi átlagmérés indítása"]', after: '.hud > .card' }, ios: [...NAV, ...HEAT_OFF, '-manual', '0'] },
  { id: 'valaszto', web: { path: '/?navsim&stage=picker&panel=0&speed=7', ready: '.picker .route-opt' }, ios: [...NAV, '-navStage', 'picker'] },
  { id: 'nav', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=60', ready: '.nav-top' }, ios: [...NAV, '-navStage', 'nav', '-simAt', '60'] },
  { id: 'nav-kozeledik', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=WIN1+95&alt=aftergate', ready: '.nav-top' }, ios: [...NAV, '-navStage', 'nav', '-simAt', 'WIN1+95', '-alt', 'aftergate'] },
  { id: 'nav-meres', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=WIN1+150&alt=aftergate', ready: '.nav-strip' }, ios: [...NAV, '-navStage', 'nav', '-simAt', 'WIN1+150', '-alt', 'aftergate'] },
  { id: 'nav-ajanlat', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=WIN1+150', ready: '.nav-offer-compact' }, ios: [...NAV, '-navStage', 'nav', '-simAt', 'WIN1+150'] },
  // AOS17j: a német felirat a leghosszabb – a szélességi hibák ezen jönnek elő
  { id: 'meres-de', lang: 'de', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=WIN1+150&alt=aftergate', ready: '.nav-strip' }, ios: [...NAV, '-navStage', 'nav', '-simAt', 'WIN1+150', '-alt', 'aftergate'] },
  { id: 'ajanlat-de', lang: 'de', web: { path: '/?navsim&stage=nav&panel=0&speed=7&at=WIN1+150', ready: '.nav-offer-compact' }, ios: [...NAV, '-navStage', 'nav', '-simAt', 'WIN1+150'] },
  { id: 'bejelentes', web: { path: '/?navsim&panel=0&heat=ki&speed=7', ready: '.card.compact', click: 'button[aria-label="Bejelentés"]', after: '.sheet .tiles' }, ios: [...NAV, ...HEAT_OFF, '-reportOpen', 'YES'] },
  { id: 'beallitasok', web: { path: '/?navsim&panel=0&sheet=settings&heat=ki&speed=7', ready: '.sheet .list' }, ios: [...NAV, ...HEAT_OFF, '-settingsOpen', 'top', '-simPlaces', 'YES'] },
  // AW22: a Fiók kártya bejelentkezve (kijelentkezve a `beallitasok` állapot teteje), az út utáni ajánlat, a Veszély választója
  { id: 'fiok-be', web: { path: '/?navsim&panel=0&sheet=settings&heat=ki&speed=7&account=in', ready: '[data-testid="account-card"]' }, ios: [...NAV, ...HEAT_OFF, '-settingsOpen', 'top', '-simPlaces', 'YES', '-accountSim', 'in'] },
  { id: 'fiok-ajanlat', web: { path: '/?navsim&panel=0&heat=ki&speed=7&nudge', ready: '.account-nudge' }, ios: [...NAV, ...HEAT_OFF, '-nudge', 'YES'] },
  { id: 'beallitasok-zona', web: { path: '/?navsim&panel=0&sheet=settings&heat=ki&speed=7', ready: '.zone-picker', scrollTo: '.zone-picker', mask: ['.sheet select.select'] }, ios: [...NAV, ...HEAT_OFF, '-settingsOpen', 'zone', '-simPlaces', 'YES'] },
];

export const pick = (argv, name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
