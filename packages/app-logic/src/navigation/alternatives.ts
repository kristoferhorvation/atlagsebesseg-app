import { Route, type LatLon } from '@atlagsebesseg/core';
import { t } from '../i18n';
import { ALT_OFFER, ROUTE_MATCH_M } from './config';
import type { NavRoute } from './types';

/** A leágazás keresésének lépésköze az alternatíva mentén (m). */
const DIVERGE_STEP_M = 25;

/** AW17: a saját (nem közös) szakasz mintavételezése az alternatíva mentén (m). */
const OWN_STEP_M = 100;
/** AW17: a képernyős elhelyezéshez a teljes útvonalak legfeljebb ennyi ponttal (egyenletesen ritkítva). */
const PATH_MAX_POINTS = 400;

/** Az alternatív útvonal címkéje a térképen: kis buborék a menetidő-különbséggel a kiválasztotthoz képest. */
export interface AltLabel {
  routeId: string;
  /** Az útvonal indexe a listában (a kiválasztás erre vált). */
  index: number;
  /**
   * Méterben számolt horgony: a saját szakasz pontja, amely a kiválasztott útvonaltól a legmesszebb van. A végleges
   * hely a képernyő-pixelben számolt {@link placeAltLabel}; ez a tartalék, amíg nincs vetítés.
   */
  at: LatLon;
  /** AW17: az alternatíva saját (nem közös) szakaszának pontjai, ~100 m-enként. */
  own: LatLon[];
  /** AW17: a leágazási pont (ezt a címke soha nem takarja). */
  divergence: LatLon;
  /** AW17: a kiválasztott és az alternatív útvonal ritkítva (a takarás méréséhez). */
  basePath: LatLon[];
  altPath: LatLon[];
  /** Az alternatíva menetideje mínusz a kiválasztotté (s); pozitív = lassabb. */
  deltaS: number;
  text: string;
}

/**
 * A leágazás: az alternatíva menti első pont (m, az alternatíva elejétől), amely már nincs a `base`
 * `ROUTE_MATCH_M` sávjában. `null`, ha az alternatíva végig a `base`-en halad.
 */
export function divergenceAlongM(base: NavRoute, alt: NavRoute, bandM = ROUTE_MATCH_M): number | null {
  const rb = new Route(base.points, base.distanceM);
  const ra = new Route(alt.points, alt.distanceM);
  for (let d = 0; d <= ra.lengthM; d += DIVERGE_STEP_M) if (rb.project(ra.pointAt(d)).crossM > bandM) return d;
  return null;
}

/** Menetidő-különbség szövege: „+1 perc”, „−2 perc”, egy percen belül „≈ ugyanannyi”. */
export function altDeltaText(deltaS: number): string {
  const n = Math.round(deltaS / 60);
  if (n === 0) return t('nav.alt.same');
  return t(n > 0 ? 'nav.alt.slower' : 'nav.alt.faster', { n: Math.abs(n) });
}

/** Egyenletes ritkítás legfeljebb `max` pontra (az első és az utolsó pont mindig marad). */
function thin(points: readonly LatLon[], max = PATH_MAX_POINTS): LatLon[] {
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

/**
 * A nem kiválasztott útvonalak címkéi a menetidő (`durationsS`, az útvonalválasztó kártyájával azonos – a szakaszokon
 * a határral számolt) különbségével. AW17: a horgony nem fix 300 m a leágazás után, hanem az alternatíva saját (nem
 * közös) szakaszának a kiválasztottól legtávolabbi pontja – a képernyős helyet a {@link placeAltLabel} adja.
 * A kiválasztottal végig egyező alternatíva nem kap címkét.
 */
export function altLabels(routes: readonly NavRoute[], durationsS: readonly number[], selected: number): AltLabel[] {
  const base = routes[selected];
  if (!base) return [];
  const rb = new Route(base.points, base.distanceM);
  const out: AltLabel[] = [];
  routes.forEach((r, index) => {
    if (index === selected) return;
    const d = divergenceAlongM(base, r);
    if (d === null) return;
    const ra = new Route(r.points, r.distanceM);
    const own: LatLon[] = [];
    let at = ra.pointAt(d);
    let farM = -1;
    for (let m = d; m <= ra.lengthM; m += OWN_STEP_M) {
      const p = ra.pointAt(m);
      const cross = rb.project(p).crossM;
      if (cross <= ROUTE_MATCH_M) continue;
      own.push(p);
      if (cross > farM) {
        farM = cross;
        at = p;
      }
    }
    const deltaS = (durationsS[index] ?? r.durationS) - (durationsS[selected] ?? base.durationS);
    out.push({
      routeId: r.id,
      index,
      at,
      own,
      divergence: ra.pointAt(d),
      basePath: thin(base.points),
      altPath: thin(r.points),
      deltaS,
      text: altDeltaText(deltaS),
    });
  });
  return out;
}

/** Képernyő-pont (px vagy pt, a bal felső saroktól). */
export interface Px {
  x: number;
  y: number;
}

/**
 * Web Mercator vetítés a képernyőre (512 px-es csempe, mint a Mapbox GL JS és a Maps SDK), észak felfelé, dőlés
 * nélkül; a `center` a nézet közepén. A közös (TS = Swift) tesztek vetítése – az app a térkép saját vetítését használja.
 */
export function mercatorScreen(p: LatLon, camera: { center: LatLon; zoom: number }, viewport: { w: number; h: number }): Px {
  const world = 512 * 2 ** camera.zoom;
  const mx = (lon: number) => ((lon + 180) / 360) * world;
  const my = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
  };
  return { x: viewport.w / 2 + mx(p.lon) - mx(camera.center.lon), y: viewport.h / 2 + my(p.lat) - my(camera.center.lat) };
}

/** A címke a horgonyhoz képest: fölötte, alatta, balra vagy jobbra. */
export type AltLabelSide = 'above' | 'below' | 'left' | 'right';

export interface AltLabelPlacementInput {
  /** Az alternatíva saját szakasza, képernyőre vetítve (az {@link AltLabel.own} pontjai). */
  own: readonly Px[];
  /** A kiválasztott útvonal (vonallánc), vetítve. */
  base: readonly Px[];
  /** A teljes alternatíva (vonallánc), vetítve. */
  alt: readonly Px[];
  /** A leágazás, vetítve. */
  divergence: Px;
  /** A címke (buborék) mérete. */
  label: { w: number; h: number };
  viewport: { w: number; h: number };
}

export interface AltLabelPlacement {
  /** A horgony: a saját szakasz pontja, amely a képernyőn a kiválasztott útvonaltól a legmesszebb van. */
  anchor: Px;
  side: AltLabelSide;
  /** A címke doboza (bal felső sarok + méret); a közepe a jelölő helye. */
  box: { x: number; y: number; w: number; h: number };
}

/**
 * A címke és a horgony közti rés, a vonalak fél vastagsága (a takarás méréséhez), a leágazás védett köre és a cél-jelölő
 * mérete (px; a jelölő alsó csúcsával áll a célon, mint a webes és az iOS-es jelölő).
 */
export const ALT_LABEL_PLACE = { gapPx: 6, lineHalfPx: 5, divergenceClearPx: 12, destPinPx: 40 } as const;

/** Az `a`–`b` szakasz `p`-hez legközelebbi pontja. */
function segNearest(p: Px, a: Px, b: Px): Px {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + u * dx, y: a.y + u * dy };
}

/** A `p` távolsága a vonallánctól, és a lánc hozzá legközelebbi pontja. */
function polylineNearest(p: Px, line: readonly Px[]): { d: number; q: Px } {
  let best = { d: Infinity, q: p };
  for (let i = 0; i < line.length; i++) {
    const q = i + 1 < line.length ? segNearest(p, line[i]!, line[i + 1]!) : line[i]!;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { d, q };
  }
  return best;
}

type Box = AltLabelPlacement['box'];

/** Metszi-e az `a`–`b` szakasz a dobozt (Liang–Barsky vágás). */
function segHitsBox(a: Px, b: Px, r: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Ennyi szakasza fut át a dobozon a vonalláncnak. */
function hits(line: readonly Px[], r: Box): number {
  let n = 0;
  for (let i = 0; i + 1 < line.length; i++) if (segHitsBox(line[i]!, line[i + 1]!, r)) n++;
  return n;
}

const SIDES: readonly { side: AltLabelSide; dx: number; dy: number }[] = [
  { side: 'above', dx: 0, dy: -1 },
  { side: 'below', dx: 0, dy: 1 },
  { side: 'left', dx: -1, dy: 0 },
  { side: 'right', dx: 1, dy: 0 },
];

/** A horgony-jelöltek legfeljebb ennyien (egyenletesen ritkítva) – a mozgás közbeni újraszámolás költsége miatt. */
const LABEL_CANDIDATES_MAX = 80;

/**
 * AW17: az alternatíva „+N perc” címkéjének helye az aktuális képernyő-vetítésben (px, az aktuális zoomon).
 * Horgony: a saját szakasz képernyőn látható pontja (ha egyik sem látszik, bármelyik), a címke mellette – fölé, alá,
 * balra vagy jobbra. A (horgony, oldal) párok pontozása, fontossági sorrendben:
 * 1. soha nem takarja a leágazást és a célt (`divergenceClearPx` körben; a cél-jelölő dobozát sem), 2. kifér a képernyőre, 3. a legkevesebb
 * útvonal-szakaszt takarja (mindkét vonalból), miközben a horgony minél messzebb van a kiválasztott útvonaltól (1,7 px
 * távolság ≈ 1 takart szakasz, `6 · d`) – tiszta helyen így a legtávolabbi pont nyer; 4. döntetlennél a kiválasztottól elfelé eső
 * oldal. Ha sehol sem fér ki, rálóghat – a cél, hogy egyértelműen az alternatívához tartozzon.
 */
export function placeAltLabel(input: AltLabelPlacementInput): AltLabelPlacement | null {
  const { own, base, alt, divergence, label, viewport } = input;
  if (own.length === 0) return null;
  const inView = (p: Px) => p.x >= 0 && p.y >= 0 && p.x <= viewport.w && p.y <= viewport.h;
  const visible = own.some(inView) ? own.filter(inView) : [...own];
  const stride = Math.max(1, Math.ceil(visible.length / LABEL_CANDIDATES_MAX));
  const candidates = visible.filter((_, i) => i % stride === 0);
  const { gapPx, lineHalfPx, divergenceClearPx, destPinPx } = ALT_LABEL_PLACE;
  const dest = base[base.length - 1];
  let best: (AltLabelPlacement & { cost: number }) | null = null;
  for (const anchor of candidates) {
    const near = polylineNearest(anchor, base);
    // elfelé: a kiválasztott útvonal legközelebbi pontjától a horgony felé
    const ax = anchor.x - near.q.x;
    const ay = anchor.y - near.q.y;
    const alen = Math.hypot(ax, ay) || 1;
    for (const s of SIDES) {
      const box: Box = {
        x: s.dx === 0 ? anchor.x - label.w / 2 : s.dx < 0 ? anchor.x - gapPx - label.w : anchor.x + gapPx,
        y: s.dy === 0 ? anchor.y - label.h / 2 : s.dy < 0 ? anchor.y - gapPx - label.h : anchor.y + gapPx,
        w: label.w,
        h: label.h,
      };
      const grown: Box = { x: box.x - lineHalfPx, y: box.y - lineHalfPx, w: box.w + 2 * lineHalfPx, h: box.h + 2 * lineHalfPx };
      // a leágazás és a cél (a kiválasztott útvonal vége, a cél-jelölő) körül védett kör
      const close = (q: Px) => Math.hypot(q.x - Math.max(box.x, Math.min(q.x, box.x + box.w)), q.y - Math.max(box.y, Math.min(q.y, box.y + box.h))) < divergenceClearPx;
      const onPin = (q: Px) => box.x < q.x + destPinPx / 2 && box.x + box.w > q.x - destPinPx / 2 && box.y < q.y && box.y + box.h > q.y - destPinPx;
      const covers = close(divergence) || (dest !== undefined && (close(dest) || onPin(dest)));
      const offscreen = box.x < 0 || box.y < 0 || box.x + box.w > viewport.w || box.y + box.h > viewport.h;
      const away = (s.dx * ax + s.dy * ay) / alen;
      const cost = (covers ? 100_000 : 0) + (offscreen ? 10_000 : 0) + 10 * (hits(base, grown) + hits(alt, grown)) - 6 * near.d - away;
      if (!best || cost < best.cost) best = { anchor, side: s.side, box, cost };
    }
  }
  const { cost: _cost, ...placed } = best!;
  return placed;
}

/** Érintés egy útvonalra (vonal vagy címke): az új kiválasztott indexe; ismeretlen azonosítónál marad a régi. */
export function selectRouteById(routes: readonly NavRoute[], selected: number, id: string): number {
  const i = routes.findIndex((r) => r.id === id);
  return i < 0 ? selected : i;
}

// ---------------------------------------------------------------------------
// „Megéri”-szabály (AW12)
// ---------------------------------------------------------------------------

/** Az ajánlat kategóriája: megéri (lejáratkor elfogadja) / lehet / nem éri meg (lejáratkor marad a régi). */
export type AltVerdict = 'worth' | 'maybe' | 'not';

export interface AltWorth {
  /** Nyereség (perc, pozitív = gyorsabb). */
  gainMin: number;
  /** Többlet-táv (km, pozitív = hosszabb). */
  extraKm: number;
  /** A kerülő ára (perc/km) az alternatíva átlagsebességéből. */
  k: number;
  /** `gainMin − k · extraKm`. */
  net: number;
  verdict: AltVerdict;
}

/** A kerülő ára (perc/km): `slowKmh`-ig `kSlow`, `fastKmh`-tól `kFast`, között lineáris. */
export function detourCostPerKm(avgKmh: number): number {
  const { slowKmh, fastKmh, kSlow, kFast } = ALT_OFFER;
  if (!(avgKmh > slowKmh)) return kSlow;
  if (avgKmh >= fastKmh) return kFast;
  return kSlow + ((avgKmh - slowKmh) / (fastKmh - slowKmh)) * (kFast - kSlow);
}

/** Az útvonal várható átlagsebessége (km/h) a Directions távolságából és idejéből. */
export const routeAvgKmh = (r: NavRoute): number => (r.durationS > 0 ? (r.distanceM / r.durationS) * 3.6 : 0);

/** Megéri-e: `net = Δperc − k · Δkm`; `net ≥ worthNetMin` → megéri, `0 < net` → lehet, különben nem éri meg. */
export function altWorth(gainS: number, extraM: number, avgKmh: number): AltWorth {
  const gainMin = gainS / 60;
  const extraKm = extraM / 1000;
  const k = detourCostPerKm(avgKmh);
  const net = gainMin - k * extraKm;
  const verdict: AltVerdict = net >= ALT_OFFER.worthNetMin ? 'worth' : net > 0 ? 'maybe' : 'not';
  return { gainMin, extraKm, k, net, verdict };
}

/** Egész perc (legalább 1) és egész km a feliratokhoz; „lehet” / „nem éri meg” esetén a kerülő legalább 1 km. */
function rounded(w: Pick<AltWorth, 'gainMin' | 'extraKm' | 'verdict'>) {
  const n = Math.max(1, Math.round(w.gainMin));
  const km = Math.round(w.extraKm);
  return { n, km: w.verdict === 'worth' ? km : Math.max(1, km) };
}

/** A kártya címe: „Megéri · −7 perc, +4 km”, „Lehet · −2 perc, +1 km”, „Nem éri meg · +20 km kerülő, −10 perc”. */
export function altOfferTitle(w: Pick<AltWorth, 'gainMin' | 'extraKm' | 'verdict'>): string {
  const { n, km } = rounded(w);
  if (w.verdict === 'maybe') return t('nav.offer.maybe', { n, km });
  if (w.verdict === 'not') return t('nav.offer.not', { n, km });
  if (km === 0) return t('nav.offer.worthNoKm', { n });
  return t('nav.offer.worth', { n, km: km > 0 ? `+${km}` : `−${-km}` });
}

/**
 * A kompakt (mérés közbeni) ajánlat két része: „Kijárat 56” / „2,1 km · −7 perc gyorsabb” (AW17: a „gyorsabb” szó
 * kötelező); név nélküli lehajtónál „Lehajtó 2,1 km-nél” / „−7 perc gyorsabb”, ismeretlen lehajtónál csak a cím.
 * `exitKm`: a lehajtóig hátralévő táv a nyelv tizedesjelével.
 */
export function altOfferCompactLines(o: {
  title: string;
  gainS: number;
  exitAlongM: number | null;
  exitName: string | null;
  exitKm: string;
}): [string, string | null] {
  const n = Math.max(1, Math.round(o.gainS / 60));
  if (o.exitAlongM === null) return [o.title, null];
  if (!o.exitName) return [t('nav.offer.exitAt', { km: o.exitKm }), t('nav.offer.compactFaster', { n })];
  return [o.exitName, t('nav.offer.compactDetail', { km: o.exitKm, n })];
}

/** AW17: a kompakt ajánlat egy sorban: „Kijárat 56 · 2,5 km · −7 perc gyorsabb” (a „gyorsabb” szó kötelező). */
export function altOfferCompactText(o: Parameters<typeof altOfferCompactLines>[0]): string {
  const [a, b] = altOfferCompactLines(o);
  return b ? `${a} · ${b}` : a;
}

/**
 * A bemondás: „Gyorsabb út, 7 perc megtakarítás, lehajtó 5,2 kilométernél” (megéri; ismeretlen lehajtónál a lehajtó
 * nélkül) / „…, 2 perc, 1 kilométer kerülő, te döntesz” / „…, de nem éri meg, 20 kilométer kerülő”. `exitKm`: a lehajtóig
 * hátralévő táv a nyelv tizedesjelével.
 */
export function altOfferVoice(w: Pick<AltWorth, 'gainMin' | 'extraKm' | 'verdict'>, exitKm: string | null = null): string {
  const { n, km } = rounded(w);
  if (w.verdict === 'maybe') return t('nav.voice.fasterMaybe', { n, km });
  if (w.verdict === 'not') return t('nav.voice.fasterNot', { km });
  return exitKm === null ? t('nav.voice.faster', { n }) : t('nav.voice.fasterWorthExit', { n, km: exitKm });
}
