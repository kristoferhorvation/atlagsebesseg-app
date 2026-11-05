import { haversineM } from '@atlagsebesseg/core';
import type { SavedPlaces } from './navigation/places';
import type { BBox } from './sectionCache';
import { TRIP, type TripSample } from './trips';

/**
 * AW20: hőtérkép – személyes (helyi) és közösségi (opt-in). Platformfüggetlen; a Swift-pár: `Logic/Heat.swift`, azonos
 * nevű tesztekkel (`heat.test.ts` ↔ `HeatTests.swift`). Az AW19 H3 res-10 mintáiból cellánkénti aggregátum készül
 * (áthaladások száma, átlagsebesség, utolsó időbélyeg), inkrementálisan: egy út végén egyszer, nem minden rajzoláskor.
 * A H3-műveletek (cella középpontja, szülő-cella) platformfüggők (web: h3-js, iOS: SwiftyH3), ezért függvényként jönnek be.
 */
export const HEAT = {
  /** A cellák felbontása (az AW19 mintákkal azonos). */
  res: TRIP.h3Res,
  /** Kicsinyítve ezen a felbontáson vonjuk össze a cellákat. */
  coarseRes: 8,
  /** Ennél kisebb zoomon (kicsinyítve) a res-8 összevont cellák látszanak. */
  coarseBelowZoom: 12.5,
  /** Egyszerre legfeljebb ennyi pont kerül a rétegre; ha a látható rész több, res-8-ra vonjuk össze. */
  maxFeatures: 4000,
  /** A látható téglalapot ennyi hányaddal bővítjük (a mozgatás ne üresítse ki a szélét). */
  viewPad: 0.25,
  /** Ennél lassabb mintán (km/h) nem számít áthaladásnak az állás. */
  minPassKmh: TRIP.idleKmh,
  /** Ugyanabban a cellában ennél nagyobb szünet (ms) után új áthaladás. */
  passGapMs: 120_000,
  /** Az út eleje és vége: az ide eső cellák sosem mennek fel (m). */
  shareEndsM: 300,
  /** A „Gyakoriság” mód: ennyi áthaladástól a súly 1. */
  freqCap: 20,
  /** Az „Átlagsebesség” mód: ennél a sebességnél (km/h) a súly 1. */
  speedMaxKmh: 130,
  /** A közösségi lekérés gyorsítótára (ms). */
  cacheMs: 600_000,
  /** A közösségi lekérés téglalapja ekkora rácsra (°) kerekítve – a mozgatás nem kér újra. */
  querySnapDeg: 0.05,
  /** Egy lekérés legfeljebb ennyi cellát ad. */
  queryLimit: 5000,
  /** A feltöltésre váró sorok maximuma (offline gyűjtés). */
  outboxMax: 2000,
  /** Adatvédelmi zóna: alapsugár (m) és a választható sugarak. */
  zoneDefaultM: 200,
  /** A cella középpontja ennyivel (m) a zónasugáron túl is még „a zónában” van (a res-10 cella éle ~66 m; res 8: ~460 m). */
  zoneMarginM: 70,
  zoneMarginCoarseM: 470,
  /** A szerveroldali nézet csak ennyi beküldésnél több cellát ad ki (a magányos áthaladás nem látszik). */
  serverMinRows: 3,
} as const;

/** A választható zónasugarak (m): 200 m / 500 m / 1 km. */
export const ZONE_RADII: readonly number[] = [200, 500, 1000];

/** Adatvédelmi zóna egy mentett hely körül (csak helyben él, szerverre nem megy). */
export interface HeatZone {
  /** `home`, `work` vagy a további mentett hely azonosítója. */
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
}

/** A tárolt zónasugarak (`hely-azonosító → m`) érvényesítése: csak a választható sugár marad. */
export function parseZoneRadii(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number' && ZONE_RADII.includes(v)) out[k] = v;
  return out;
}

/** Minden mentett hely (Haza, Munka, további) körül egy zóna; a sugár helyenként állítható, alapból 200 m (AOS18). */
export function heatZones(saved: SavedPlaces, radii: Readonly<Record<string, number>>): HeatZone[] {
  const at = (id: string, p: { lat: number; lon: number }): HeatZone => ({ id, lat: p.lat, lon: p.lon, radiusM: ZONE_RADII.includes(radii[id] ?? 0) ? radii[id]! : HEAT.zoneDefaultM });
  return [...(saved.home ? [at('home', saved.home)] : []), ...(saved.work ? [at('work', saved.work)] : []), ...saved.others.map((p) => at(p.id, p))];
}

/** A pont (cella középpontja) bármelyik zónában van-e (a sugárhoz `marginM` ráhagyással). */
export function inZone(p: { lat: number; lon: number }, zones: readonly HeatZone[], marginM: number = HEAT.zoneMarginM): boolean {
  return zones.some((z) => haversineM(p, z) <= z.radiusM + marginM);
}

/** Hőtérkép-mód a Beállításokban: ki / saját / közösségi. */
export type HeatMode = 'ki' | 'sajat' | 'kozossegi';
export const HEAT_MODES: readonly HeatMode[] = ['ki', 'sajat', 'kozossegi'];

/** Mit mutat a hőtérkép: az áthaladások számát vagy az átlagsebességet. */
export type HeatView = 'gyakorisag' | 'atlagsebesseg';
export const HEAT_VIEWS: readonly HeatView[] = ['gyakorisag', 'atlagsebesseg'];

/** Egy áthaladás egy cellán az út mintáiból. */
export interface HeatPass {
  h3: string;
  /** A cellában mért átlagsebesség (km/h; a mozgó minták átlaga). */
  avgKmh: number;
  /** Az első minta ideje (ms). */
  t: number;
  /** Az út kezdetétől mért táv az első mintánál (m). */
  fromStartM: number;
  /** Az út végéig hátralévő táv az utolsó mintánál (m). */
  toEndM: number;
}

/** A cella összesítése (a helyi tárolóban cellánként egy sor). */
export interface HeatCell {
  h3: string;
  count: number;
  avgKmh: number;
  /** Az utolsó áthaladás ideje (ms). */
  lastT: number;
}

/** Egy sor a közösségi feltöltésben (a `heat_cells` tábla oszlopai). */
export interface HeatUploadRow {
  h3: string;
  h3_r8: string;
  lat: number;
  lon: number;
  count: number;
  avg_speed: number;
  hour: number;
  dow: number;
}

/** A közösségi nézet egy cellája (a `heat_global` / `heat_global_r8` sora). */
export interface HeatGlobalRow {
  h3: string;
  lat: number;
  lon: number;
  count: number;
  avg_speed: number;
}

/** A H3-műveletek (web: h3-js, iOS: SwiftyH3). */
export interface HeatGeo {
  /** A cella középpontja. */
  center(h3: string): { lat: number; lon: number };
  /** A szülő-cella a megadott felbontáson. */
  parent(h3: string, res: number): string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

// ---------------------------------------------------------------------------
// áthaladások az út mintáiból
// ---------------------------------------------------------------------------

/**
 * Az út mintáiból (időrendben) a cellánkénti áthaladások: egy áthaladás = ugyanabban a cellában egymás utáni minták.
 * Az átlag a mozgó mintákból számol; ha a cellában csak álló minta volt, nem áthaladás. A táv az út elejétől / végéig
 * a minták közti távolságokból (a `maxJumpKmh`-nál gyorsabb ugrás nem táv) – a lakóhely-védelemhez.
 */
export function tripPasses(samples: readonly TripSample[]): HeatPass[] {
  const s = samples.filter((x) => x.h3 !== null).sort((a, b) => a.t - b.t);
  if (s.length === 0) return [];
  const cum: number[] = [0];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    const d = haversineM(a, b);
    const dt = (b.t - a.t) / 1000;
    cum.push(cum[i - 1]! + (dt > 0 && (d / dt) * 3.6 <= TRIP.maxJumpKmh ? d : 0));
  }
  const total = cum[cum.length - 1]!;
  const out: HeatPass[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1]!.h3 === s[i]!.h3 && s[j + 1]!.t - s[j]!.t <= HEAT.passGapMs) j++;
    const moving = s.slice(i, j + 1).filter((x) => x.speedKmh !== null && x.speedKmh >= HEAT.minPassKmh);
    if (moving.length > 0) {
      out.push({
        h3: s[i]!.h3!,
        avgKmh: round1(moving.reduce((sum, x) => sum + x.speedKmh!, 0) / moving.length),
        t: s[i]!.t,
        fromStartM: cum[i]!,
        toEndM: total - cum[j]!,
      });
    }
    i = j + 1;
  }
  return out;
}

/** Az áthaladások beolvasztása a cellák közé (a `cells` helyben módosul); a változott cellák listáját adja. */
export function mergePasses(cells: Map<string, HeatCell>, passes: readonly HeatPass[]): HeatCell[] {
  const changed = new Map<string, HeatCell>();
  for (const p of passes) {
    const c = cells.get(p.h3);
    const next: HeatCell = c
      ? { h3: p.h3, count: c.count + 1, avgKmh: round1((c.avgKmh * c.count + p.avgKmh) / (c.count + 1)), lastT: Math.max(c.lastT, p.t) }
      : { h3: p.h3, count: 1, avgKmh: p.avgKmh, lastT: p.t };
    cells.set(p.h3, next);
    changed.set(p.h3, next);
  }
  return [...changed.values()];
}

// ---------------------------------------------------------------------------
// közösségi feltöltés (adatvédelem)
// ---------------------------------------------------------------------------

/** Az út első és utolsó `shareEndsM` méterének cellái (a lakóhely-védelem): minden áthaladásuk kimarad. */
export function endCells(passes: readonly HeatPass[], endsM: number = HEAT.shareEndsM): Set<string> {
  const out = new Set<string>();
  for (const p of passes) if (p.fromStartM < endsM || p.toEndM < endsM) out.add(p.h3);
  return out;
}

/**
 * A feltöltendő sorok: a védett cellák nélkül, (cella, óra, hét napja) szerint összevonva – nincs útvonal, nincs pontos
 * idő (csak az óra-sáv és a nap), nincs azonosító. Az adatvédelmi zónák cellái (mentett helyek körül) szintén kimaradnak. `tzOffsetMin`: a készülék UTC-eltolása percben (kelet pozitív).
 */
export function uploadRows(passes: readonly HeatPass[], geo: HeatGeo, tzOffsetMin: number, endsM: number = HEAT.shareEndsM, zones: readonly HeatZone[] = []): HeatUploadRow[] {
  const blocked = endCells(passes, endsM);
  const zoneCache = new Map<string, boolean>();
  const zoned = (h3: string) => {
    let z = zoneCache.get(h3);
    if (z === undefined) {
      z = zones.length > 0 && inZone(geo.center(h3), zones);
      zoneCache.set(h3, z);
    }
    return z;
  };
  const groups = new Map<string, { h3: string; hour: number; dow: number; n: number; sum: number }>();
  for (const p of passes) {
    if (blocked.has(p.h3) || zoned(p.h3)) continue;
    const local = new Date(p.t + tzOffsetMin * 60_000);
    const hour = local.getUTCHours();
    const dow = local.getUTCDay();
    const key = `${p.h3}|${hour}|${dow}`;
    const g = groups.get(key) ?? { h3: p.h3, hour, dow, n: 0, sum: 0 };
    g.n++;
    g.sum += p.avgKmh;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const c = geo.center(g.h3);
    return { h3: g.h3, h3_r8: geo.parent(g.h3, HEAT.coarseRes), lat: round5(c.lat), lon: round5(c.lon), count: g.n, avg_speed: round1(g.sum / g.n), hour: g.hour, dow: g.dow };
  });
}

/** A feltöltésre váró sorok a helyi tárolóból (sérült tartalom helyett üres). */
export function parseHeatOutbox(raw: string | null | undefined): HeatUploadRow[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as HeatUploadRow[]).filter((r) => typeof r?.h3 === 'string' && typeof r.count === 'number') : [];
  } catch {
    return [];
  }
}

/** Új sorok a várakozók után; a legrégebbiek esnek ki, ha túllépi a `outboxMax`-ot. */
export const appendHeatOutbox = (queue: readonly HeatUploadRow[], rows: readonly HeatUploadRow[]): HeatUploadRow[] => [...queue, ...rows].slice(-HEAT.outboxMax);

// ---------------------------------------------------------------------------
// megjelenítés
// ---------------------------------------------------------------------------

/** Az aktuális zoomhoz tartozó cella-felbontás: közelről 10, kicsinyítve 8. */
export const heatResForZoom = (zoom: number): number => (zoom < HEAT.coarseBelowZoom ? HEAT.coarseRes : HEAT.res);

/** A hőtérkép-pont súlya (0…1) a módban. */
export function heatWeight(cell: Pick<HeatCell, 'count' | 'avgKmh'>, view: HeatView): number {
  if (view === 'gyakorisag') return Math.min(1, Math.log1p(cell.count) / Math.log1p(HEAT.freqCap));
  return Math.max(0, Math.min(1, cell.avgKmh / HEAT.speedMaxKmh));
}

/** Cellák összevonása szülő-cellákba (az áthaladások súlyozott átlagával). */
export function coarsenCells(cells: Iterable<HeatCell>, geo: HeatGeo, res: number = HEAT.coarseRes): HeatCell[] {
  const out = new Map<string, HeatCell>();
  for (const c of cells) {
    const key = geo.parent(c.h3, res);
    const o = out.get(key);
    out.set(
      key,
      o ? { h3: key, count: o.count + c.count, avgKmh: round1((o.avgKmh * o.count + c.avgKmh * c.count) / (o.count + c.count)), lastT: Math.max(o.lastT, c.lastT) } : { ...c, h3: key },
    );
  }
  return [...out.values()];
}

/** Egy pont a hőtérkép-rétegen. */
export interface HeatPoint {
  lat: number;
  lon: number;
  weight: number;
}

/** A látható terület a megjelenítéshez (a zoom és a téglalap). */
export interface HeatViewport {
  zoom: number;
  bbox: BBox;
}

const padded = (b: BBox, f: number): BBox => {
  const dLat = (b.north - b.south) * f;
  const dLon = (b.east - b.west) * f;
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLon, east: b.east + dLon };
};
const inside = (p: { lat: number; lon: number }, b: BBox) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;

/**
 * A hőtérkép indexe: a cellák középpontját és az összevont (res-8) változatot gyorsítótárazza, így a rajzolás nem számol
 * újra mindent (a változás után csak a módosult cellák frissülnek, a res-8 összesítés lustán újraépül).
 */
export class HeatIndex {
  private readonly cells = new Map<string, HeatCell>();
  private readonly centers = new Map<string, { lat: number; lon: number }>();
  private zones: readonly HeatZone[] = [];
  private part: { fine: HeatCell[]; zoned: HeatCell[] } | null = null;
  private coarse: { cell: HeatCell; lat: number; lon: number }[] | null = null;
  private coarseZoned: { cell: HeatCell; lat: number; lon: number }[] | null = null;

  constructor(private readonly geo: HeatGeo) {}

  get size(): number {
    return this.cells.size;
  }

  private reset(): void {
    this.part = null;
    this.coarse = null;
    this.coarseZoned = null;
  }

  /** A teljes tartalom cseréje. */
  setAll(cells: Iterable<HeatCell>): void {
    this.cells.clear();
    this.reset();
    for (const c of cells) this.cells.set(c.h3, c);
  }

  /** Módosult cellák beolvasztása (egy út vége után). */
  upsert(cells: Iterable<HeatCell>): void {
    for (const c of cells) this.cells.set(c.h3, c);
    this.reset();
  }

  /** Az adatvédelmi zónák: a bennük lévő cellák nem színeződnek, szürkén jelennek meg. */
  setZones(zones: readonly HeatZone[]): void {
    this.zones = zones;
    this.reset();
  }

  all(): Map<string, HeatCell> {
    return this.cells;
  }

  private center(h3: string) {
    let c = this.centers.get(h3);
    if (!c) {
      c = this.geo.center(h3);
      this.centers.set(h3, c);
    }
    return c;
  }

  /** A cellák két csoportra: normál, illetve zónában lévő (a zónán kívül eső cellák színeződnek). */
  private partition() {
    if (!this.part) {
      const fine: HeatCell[] = [];
      const zoned: HeatCell[] = [];
      for (const c of this.cells.values()) (this.zones.length > 0 && inZone(this.center(c.h3), this.zones) ? zoned : fine).push(c);
      this.part = { fine, zoned };
    }
    return this.part;
  }

  private coarseLists() {
    if (!this.coarse || !this.coarseZoned) {
      const p = this.partition();
      const build = (cells: HeatCell[]) => coarsenCells(cells, this.geo).map((cell) => ({ cell, ...this.geo.center(cell.h3) }));
      this.coarse = build(p.fine);
      this.coarseZoned = build(p.zoned);
    }
    return { normal: this.coarse, zoned: this.coarseZoned };
  }

  /**
   * A látható pontok: közelről res-10, kicsinyítve (vagy ha túl sok lenne) res-8; csak a látható téglalap (kis ráhagyással).
   * A `grey` a zónákban lévő cellák (nem színezve, szürkén rajzolandók).
   */
  points(vp: HeatViewport, view: HeatView): { res: number; points: HeatPoint[]; grey: HeatPoint[] } {
    const box = padded(vp.bbox, HEAT.viewPad);
    if (heatResForZoom(vp.zoom) === HEAT.res) {
      const part = this.partition();
      const pick = (cells: HeatCell[]) => {
        const out: HeatPoint[] = [];
        for (const c of cells) {
          const p = this.center(c.h3);
          if (inside(p, box)) out.push({ lat: p.lat, lon: p.lon, weight: heatWeight(c, view) });
        }
        return out;
      };
      const fine = pick(part.fine);
      const grey = pick(part.zoned);
      if (fine.length + grey.length <= HEAT.maxFeatures) return { res: HEAT.res, points: fine, grey };
    }
    const lists = this.coarseLists();
    const pick = (l: { cell: HeatCell; lat: number; lon: number }[]) => {
      const out: HeatPoint[] = [];
      for (const { cell, lat, lon } of l) if (inside({ lat, lon }, box)) out.push({ lat, lon, weight: heatWeight(cell, view) });
      return out;
    };
    return { res: HEAT.coarseRes, points: pick(lists.normal), grey: pick(lists.zoned) };
  }
}

/** A közösségi sorok pontokká (a súly a módban; a gyakoriság a beküldések száma). */
export function globalPoints(rows: readonly HeatGlobalRow[], view: HeatView): HeatPoint[] {
  return rows.map((r) => ({ lat: r.lat, lon: r.lon, weight: heatWeight({ count: r.count, avgKmh: r.avg_speed }, view) }));
}

// ---------------------------------------------------------------------------
// közösségi lekérés: rácsra kerekített téglalap + 10 perces gyorsítótár
// ---------------------------------------------------------------------------

/** A lekérés téglalapja: a látható terület (ráhagyással) kifelé a `querySnapDeg` rácsra kerekítve. */
export function heatQueryBox(bbox: BBox): BBox {
  const b = padded(bbox, HEAT.viewPad);
  const g = HEAT.querySnapDeg;
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  return { south: r(Math.floor(b.south / g) * g), north: r(Math.ceil(b.north / g) * g), west: r(Math.floor(b.west / g) * g), east: r(Math.ceil(b.east / g) * g) };
}

export const heatQueryKey = (box: BBox, res: number): string => `${res}:${box.south},${box.west},${box.north},${box.east}`;

/** A közösségi lekérések gyorsítótára: azonos (felbontás, téglalap) `cacheMs`-ig nem kér újra. */
export class HeatGlobalCache<Row = HeatGlobalRow> {
  private readonly entries = new Map<string, { at: number; rows: Row[] }>();
  constructor(private readonly now: () => number) {}

  /** A friss bejegyzés, vagy `null`. */
  get(key: string): Row[] | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (this.now() - e.at > HEAT.cacheMs) {
      this.entries.delete(key);
      return null;
    }
    return e.rows;
  }

  set(key: string, rows: Row[]): void {
    this.entries.set(key, { at: this.now(), rows });
  }
}

// ---------------------------------------------------------------------------
// az út színezése a mért sebesség szerint (napló-részlet)
// ---------------------------------------------------------------------------

/**
 * Sebesség → szín-hely (0 zöld, 0,5 sárga, 1 piros). Ismert tábla-limitnél a limithez képest (≤ 90% zöld, a limitnél sárga,
 * ≥ 115% piros); különben abszolút skálán (≤ 50 zöld, 90 sárga, ≥ 130 km/h piros).
 */
export const SPEED_TONE = { relGreen: 0.9, relYellow: 1, relRed: 1.15, absGreen: 50, absYellow: 90, absRed: 130, steps: 12 } as const;

export function speedTone(kmh: number, limitKmh: number | null): number {
  const [g, y, r] = limitKmh && limitKmh > 0 ? [SPEED_TONE.relGreen, SPEED_TONE.relYellow, SPEED_TONE.relRed].map((x) => x * limitKmh) : [SPEED_TONE.absGreen, SPEED_TONE.absYellow, SPEED_TONE.absRed];
  const v = kmh;
  if (v <= g!) return 0;
  if (v >= r!) return 1;
  return v <= y! ? (0.5 * (v - g!)) / (y! - g!) : 0.5 + (0.5 * (v - y!)) / (r! - y!);
}

/** Egy egyszínű útszakasz a részlet-térképen. */
export interface SpeedRun {
  /** A szín-hely lépcsőzve (`SPEED_TONE.steps` fokozat, 0…1). */
  tone: number;
  points: [number, number][];
}

/**
 * Az út színezett szakaszai a mintákból: egymás utáni, azonos fokozatú minták egy szakasz (a szomszédos szakaszok
 * közös ponttal kapcsolódnak). Pontatlan (> `maxAccuracyM`) minta kimarad; ugrásnál (> `maxJumpKmh`) vagy 10 s-nál
 * nagyobb résnél új szakasz kezdődik; a sebesség nélküli minta az előző színét kapja.
 */
export function speedRuns(samples: readonly TripSample[]): SpeedRun[] {
  const s = [...samples].sort((a, b) => a.t - b.t).filter((x) => x.accuracy === null || x.accuracy <= TRIP.maxAccuracyM);
  const out: SpeedRun[] = [];
  let tone = 0;
  let prev: TripSample | null = null;
  let cur: SpeedRun | null = null;
  for (const x of s) {
    if (x.speedKmh !== null) tone = Math.round(speedTone(x.speedKmh, x.limitKmh) * SPEED_TONE.steps) / SPEED_TONE.steps;
    const pt: [number, number] = [Math.round(x.lat * 1e6) / 1e6, Math.round(x.lon * 1e6) / 1e6];
    const dt = prev ? (x.t - prev.t) / 1000 : 0;
    const jump = prev !== null && (dt > 10 || (dt > 0 && (haversineM(prev, x) / dt) * 3.6 > TRIP.maxJumpKmh));
    if (!cur || jump) {
      cur = { tone, points: [pt] };
      out.push(cur);
    } else if (cur.tone !== tone) {
      const joint: [number, number] = cur.points[cur.points.length - 1]!;
      cur = { tone, points: [joint, pt] };
      out.push(cur);
    } else cur.points.push(pt);
    prev = x;
  }
  return out.filter((r) => r.points.length >= 2);
}
