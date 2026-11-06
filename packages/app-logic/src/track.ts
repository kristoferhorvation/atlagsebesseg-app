import { bearingDeg, haversineM } from '@atlagsebesseg/core';
import { HEAT, heatWeight, inZone, type HeatView, type HeatZone, type HeatViewport } from './heat';
import { simplifyPath, TRIP, type TripSample } from './trips';

/**
 * AW24: hőtérkép csíkokkal (a rácscellák helyett). Platformfüggetlen; a Swift-pár: `Logic/Track.swift`, azonos nevű tesztekkel
 * (`track.test.ts` ↔ `TrackTests.swift`), közös fixtúrán (`fixtures/track-budapest.json`, valódi nyers nyomat).
 *
 * AW25 (Kristof döntése, Mapbox-feltételek: a Map Matching eredménye nem tárolható): a csík a SAJÁT nyers GPS-pontokból készül. Út végén:
 * minták → pontsor (`recordTrace`: 20 m-es pontok, pontosság-szűrés, kiesésnél megszakad) → illesztő (`TrackMatcher`, cserélhető; ma a
 * `gridMatcher`: a pontsor egy rögzített, kb. 22 m-es rács celláin át, így ugyanaz az utca más utakon ugyanazokat a szakaszkulcsokat adja;
 * később saját Valhalla-szerver) → útszakaszok (`trackSegments`). A lépcsőzést csak a kirajzolás simítja (`smoothLine`).
 */
export const TRACK = {
  /** Kb. ennyi méterenként egy pont… */
  pointEveryM: 20,
  /** …vagy ekkora irányváltásnál (fok). */
  turnDeg: 30,
  /** Az irányt csak ennyi elmozdulástól nézzük (m), az álló GPS-zaj nem irányváltás. */
  turnMinM: 8,
  /** Ekkora ugrás pont nélkül valódi GPS-kiesés: a csík megszakad (m). */
  gapM: 200,
  /** AW25: a rács-illesztő cellája szélességben (fok, kb. 22 m); hosszúságban egész fokos sávonként a szélesség koszinuszával nyújtva. */
  gridDeg: 0.0002,
  /** A pontsor mintavétele a cellák kereséséhez (m): kisebb a cellánál, így a cellasor folytonos. */
  gridSampleM: 5,
  /** A kirajzolás egyszerűsítése (Douglas–Peucker, m; a cellalépcső legfeljebb ~16 m-re tér el az átlótól): az átlós utca cellalépcsője egyenes lesz, a valódi kanyar marad. */
  smoothSimplifyM: 20,
  /** A kirajzolás simítása utána (Chaikin-lépések): a töréspontok kerekek, a végpontok maradnak. */
  smoothSteps: 2,
  /** Az útszakaszok hossza a vonal mentén (m). */
  segmentM: 25,
  /** A szakasz kulcsának kerekítése (fok, kb. 1 m). */
  keyDecimals: 5,
  /** Ennyi fokozatra kerekítjük a súlyt, hogy az azonos színű szomszédok egy vonallá álljanak össze. */
  colorSteps: 16,
  /** Egyszerre legfeljebb ennyi vonal kerül a rétegre (a legtöbbet használtak előre). */
  maxLines: 6000,
  /** A közösségi lekérés legfeljebb ennyi szakaszt ad. */
  queryLimit: 5000,
  /** A feltöltésre váró szakasz-sorok maximuma. */
  outboxMax: 4000,
  /** A zóna széléhez adott ráhagyás a szakasz középpontjára (m). */
  zoneMarginM: 25,
} as const;

/** Az illesztő jelölése az eredményen. A `mapbox` csak a régi (AW24) tárolt adat felismeréséhez kell: az ilyen geometria cserélendő (`migrateTrack`). */
export const MATCHER_MAPBOX = 'mapbox';
/** AW25: a saját rács-illesztő (nyers GPS-pontokból). */
export const MATCHER_GRID = 'grid';

export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  kmh: number | null;
  acc: number | null;
}

/** Egy összefüggő vonaldarab: `matched` a saját illesztővel készült (stabil szakaszkulcsok, mehet a közösségbe), különben a nyers pontok közti egyenes. */
export interface TrackLine {
  matched: boolean;
  coords: [number, number][];
  /** A csúcsok sebessége (km/h), a `coords`-szal azonos hosszú. */
  kmh: number[];
}

export interface TripTrack {
  tripId: string;
  startedAt: number;
  status: 'pending' | 'done';
  /** Az út végén kért közösségi megosztás (a visszamenőleg feldolgozott régi út nem megy fel). */
  share: boolean;
  /** A nyers pontsor darabokban (megszakadás a GPS-kiesésnél): ebből bármikor újraépíthető más illesztővel. */
  parts: TrackPoint[][];
  lines: TrackLine[];
  /** Melyik illesztő készítette; `null`: nem volt illesztés (szimulátor, token nélkül). */
  matcher: string | null;
}

const distance = (a: readonly [number, number], b: readonly [number, number]) => haversineM({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });

/** Az út pontsora a mintákból: ±`maxAccuracyM`-nél rosszabb minta kimarad; `pointEveryM`-enként vagy irányváltásnál egy pont; `gapM` fölötti ugrásnál új darab. */
export function recordTrace(samples: readonly TripSample[]): TrackPoint[][] {
  const s = samples.filter((x) => x.accuracy === null || x.accuracy <= TRIP.maxAccuracyM).sort((a, b) => a.t - b.t);
  const parts: TrackPoint[][] = [];
  let cur: TrackPoint[] = [];
  let prev: TripSample | null = null;
  let lastBearing: number | null = null;
  const point = (x: TripSample): TrackPoint => ({ t: x.t, lat: x.lat, lon: x.lon, kmh: x.speedKmh, acc: x.accuracy });
  for (const x of s) {
    if (prev && haversineM(prev, x) > TRACK.gapM) {
      if (cur.at(-1)?.t !== prev.t) cur.push(point(prev));
      if (cur.length >= 2) parts.push(cur);
      cur = [];
      lastBearing = null;
    }
    prev = x;
    const last = cur.at(-1);
    if (!last) {
      cur.push(point(x));
      continue;
    }
    const d = haversineM(last, x);
    if (d < TRACK.turnMinM) continue;
    const b = bearingDeg(last, x);
    const turned = lastBearing !== null && Math.abs(((b - lastBearing + 540) % 360) - 180) >= TRACK.turnDeg;
    if (d >= TRACK.pointEveryM || turned) {
      cur.push(point(x));
      lastBearing = b;
    }
  }
  if (prev && cur.at(-1)?.t !== prev.t) cur.push(point(prev));
  if (cur.length >= 2) parts.push(cur);
  return parts;
}

const lengthOf = (c: readonly [number, number][]) => c.slice(1).reduce((sum, x, i) => sum + distance(c[i]!, x), 0);

/** Cserélhető illesztő-réteg: a nyers pontsor darabjaiból vonalak (ma a saját rács-illesztő, később saját Valhalla-szerver). Hálózati hiba: kivétel. */
export interface TrackMatcher {
  readonly id: string;
  lines(parts: readonly (readonly TrackPoint[])[]): Promise<TrackLine[]>;
}

/** A rács cellája: egész indexek; a hosszúsági lépés az egész fokos szélességi sávból, így a cella helye mindenhol determinisztikus. */
const lonStep = (lat: number) => TRACK.gridDeg / Math.cos((Math.floor(lat) + 0.5) * (Math.PI / 180));
const cellOf = (lat: number, lon: number): [number, number] => [Math.floor(lat / TRACK.gridDeg), Math.floor(lon / lonStep(lat))];
const cellCenter = (c: readonly [number, number]): [number, number] => {
  const lat = (c[0] + 0.5) * TRACK.gridDeg;
  return [round6(lat), round6((c[1] + 0.5) * lonStep(lat))];
};

/**
 * AW25: a saját illesztő. A pontsor darabjait sűrűn mintázva a rács cellasorává alakítja (az egymást követő azonos cella egy; az A–B–A
 * visszalépés – GPS-zaj a cellahatáron – kimarad), a vonal a cellaközéppontokon halad. Darabonként külön vonal: a kiesésnél megszakad.
 */
export function gridLines(parts: readonly (readonly TrackPoint[])[]): TrackLine[] {
  const out: TrackLine[] = [];
  for (const part of parts) {
    if (part.length < 2) continue;
    const cells: { c: [number, number]; kmh: number }[] = [];
    const visit = (lat: number, lon: number, kmh: number) => {
      const c = cellOf(lat, lon);
      const last = cells.at(-1);
      if (last && last.c[0] === c[0] && last.c[1] === c[1]) return;
      const prev = cells.at(-2);
      if (prev && prev.c[0] === c[0] && prev.c[1] === c[1]) {
        cells.pop();
        return;
      }
      cells.push({ c, kmh });
    };
    for (let i = 0; i < part.length - 1; i++) {
      const p = part[i]!;
      const q = part[i + 1]!;
      const n = Math.max(1, Math.ceil(haversineM(p, q) / TRACK.gridSampleM));
      for (let k = 0; k < n; k++) visit(p.lat + ((q.lat - p.lat) * k) / n, p.lon + ((q.lon - p.lon) * k) / n, (p.kmh ?? 0) + (((q.kmh ?? 0) - (p.kmh ?? 0)) * k) / n);
    }
    const last = part.at(-1)!;
    visit(last.lat, last.lon, last.kmh ?? 0);
    if (cells.length >= 2) out.push({ matched: true, coords: cells.map((x) => cellCenter(x.c)), kmh: cells.map((x) => round1(x.kmh)) });
  }
  return out;
}

export const gridMatcher: TrackMatcher = { id: MATCHER_GRID, lines: async (parts) => gridLines(parts) };

/**
 * AW25: a tárolt út a döntés után. A Mapbox-illesztett (vagy illesztés nélküli régi, egyenes) vonal a nyers pontsorból újraépül a saját
 * illesztővel; ahol nincs nyers pontsor, a Mapbox-geometria törlődik (üres `lines`; a rekord marad, hogy ne épüljön újra). Függő és már
 * rács-illesztett út változatlan (ugyanaz az objektum: a hívó így látja, hogy nincs mit írni).
 */
export function migrateTrack(t: TripTrack): TripTrack {
  if (t.status !== 'done' || t.matcher === MATCHER_GRID) return t;
  const parts = t.parts.filter((p) => p.length >= 2);
  if (parts.length === 0 && t.matcher !== MATCHER_MAPBOX) return t;
  return { ...t, lines: gridLines(parts), matcher: MATCHER_GRID };
}

/**
 * Kirajzoláshoz: Douglas–Peucker (`smoothSimplifyM`, a rács lépcsője egyenes lesz), majd Chaikin-simítás (`smoothSteps` lépés); a végpontok
 * maradnak. A tárolt adat és a szakaszkulcsok nem változnak.
 */
export function smoothLine(coords: readonly [number, number][], steps: number = TRACK.smoothSteps): [number, number][] {
  let c = simplifyPath(coords.map(([lat, lon]) => ({ lat, lon })), TRACK.smoothSimplifyM).map((p) => [p.lat, p.lon] as [number, number]);
  for (let s = 0; s < steps && c.length > 2; s++) {
    const n: [number, number][] = [c[0]!];
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i]!;
      const b = c[i + 1]!;
      if (i > 0) n.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      if (i < c.length - 2) n.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    n.push(c.at(-1)!);
    c = n;
  }
  return c;
}

/** Az út helyi rekordja a mintákból, feldolgozásra várva. */
export function pendingTrack(tripId: string, startedAt: number, samples: readonly TripSample[], share: boolean): TripTrack {
  return { tripId, startedAt, status: 'pending', share, parts: recordTrace(samples), lines: [], matcher: null };
}

// ---------------------------------------------------------------------------
// útszakaszok (a közösségi összesítés és a kirajzolás egysége)
// ---------------------------------------------------------------------------

export interface TrackSegment {
  /** Stabil kulcs a két végpontból (irányfüggetlen): az úthálózat csúcsai utak közt azonosak. */
  key: string;
  a: [number, number];
  b: [number, number];
  kmh: number;
  matched: boolean;
  /** Az út első vagy utolsó `shareEndsM` méterén van (lakóhely-védelem). */
  nearEnd: boolean;
}

const roundKey = (x: number) => x.toFixed(TRACK.keyDecimals);

export function segmentKey(a: readonly [number, number], b: readonly [number, number]): string {
  const ka = `${roundKey(a[0])},${roundKey(a[1])}`;
  const kb = `${roundKey(b[0])},${roundKey(b[1])}`;
  return ka < kb ? `${ka};${kb}` : `${kb};${ka}`;
}

/**
 * Az út vonalai útszakaszokra: az úthálózat két csúcsa közti él `segmentM`-es egyenlő darabokra, így ugyanaz az utca más utakon is ugyanazokat a szakaszokat adja. A távolság
 * az út elejétől / végéig a vonalak mentén, a kiesés nem számít bele.
 */
export function trackSegments(lines: readonly TrackLine[]): TrackSegment[] {
  const total = lines.reduce((s, l) => s + lengthOf(l.coords), 0);
  const out: TrackSegment[] = [];
  let run = 0;
  for (const l of lines) {
    for (let i = 0; i < l.coords.length - 1; i++) {
      const a = l.coords[i]!;
      const b = l.coords[i + 1]!;
      const d = distance(a, b);
      if (d === 0) continue;
      const n = Math.max(1, Math.round(d / TRACK.segmentM));
      for (let k = 0; k < n; k++) {
        const pa: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const pb: [number, number] = k === n - 1 ? [b[0], b[1]] : [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
        const from = run + (d * k) / n;
        const to = run + (d * (k + 1)) / n;
        out.push({ key: segmentKey(pa, pb), a: pa, b: pb, kmh: l.kmh[i]! + ((l.kmh[i + 1]! - l.kmh[i]!) * (k + 0.5)) / n, matched: l.matched, nearEnd: from < HEAT.shareEndsM || total - to < HEAT.shareEndsM });
      }
      run += d;
    }
  }
  return out;
}

const midOf = (a: readonly [number, number], b: readonly [number, number]) => ({ lat: (a[0] + b[0]) / 2, lon: (a[1] + b[1]) / 2 });

/** Egy sor a közösségi feltöltésben (a `heat_segments` tábla oszlopai): nincs útvonal, azonosító, pontos idő. */
export interface SegmentUploadRow {
  seg_key: string;
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
  count: number;
  avg_speed: number;
  hour: number;
  dow: number;
}

/** A közösségi nézet egy szakasza (`heat_segments_global`). */
export interface SegmentGlobalRow {
  seg_key: string;
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
  count: number;
  avg_speed: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * A feltöltendő szakaszok: csak illesztett vonalról; a mentett helyek zónáin belül és az út első / utolsó 300 m-én semmi. A védett szakasz az út minden áthaladásával kimarad
 * (a visszafelé jövő ág sem fedi fel). Óra-sáv és hét napja az út kezdetéből, percre pontos idő nincs.
 */
export function segmentUploadRows(track: Pick<TripTrack, 'lines' | 'startedAt'>, tzOffsetMin: number, zones: readonly HeatZone[] = []): SegmentUploadRow[] {
  const segs = trackSegments(track.lines);
  const blocked = new Set(segs.filter((s) => s.nearEnd).map((s) => s.key));
  const local = new Date(track.startedAt + tzOffsetMin * 60_000);
  const hour = local.getUTCHours();
  const dow = local.getUTCDay();
  const groups = new Map<string, SegmentUploadRow & { sum: number }>();
  for (const s of segs) {
    if (!s.matched || blocked.has(s.key) || (zones.length > 0 && inZone(midOf(s.a, s.b), zones, TRACK.zoneMarginM))) continue;
    const g = groups.get(s.key);
    if (g) {
      g.count++;
      g.sum += s.kmh;
    } else groups.set(s.key, { seg_key: s.key, lat1: round6(s.a[0]), lon1: round6(s.a[1]), lat2: round6(s.b[0]), lon2: round6(s.b[1]), count: 1, avg_speed: 0, hour, dow, sum: s.kmh });
  }
  return [...groups.values()].map(({ sum, ...r }) => ({ ...r, avg_speed: round1(sum / r.count) }));
}

/** A feltöltésre váró sorok a helyi tárolóból (sérült tartalom helyett üres). */
export function parseSegmentOutbox(raw: string | null | undefined): SegmentUploadRow[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as SegmentUploadRow[]).filter((r) => typeof r?.seg_key === 'string' && typeof r.count === 'number') : [];
  } catch {
    return [];
  }
}

export const appendSegmentOutbox = (queue: readonly SegmentUploadRow[], rows: readonly SegmentUploadRow[]): SegmentUploadRow[] => [...queue, ...rows].slice(-TRACK.outboxMax);

// ---------------------------------------------------------------------------
// kirajzolás
// ---------------------------------------------------------------------------

/** Egy vonal a rétegen: a súly (0…1) a módban, a `grey` a zónában vagy csak az út elején / végén járt szakasz. */
export interface HeatLine {
  coords: [number, number][];
  weight: number;
  grey: boolean;
}

interface Agg {
  a: [number, number];
  b: [number, number];
  /** A színezett áthaladások (az út vége nélkül). */
  count: number;
  /** A sebesség-átlaghoz: a nem védett áthaladások összege. */
  sum: number;
  mid: { lat: number; lon: number };
}

const quantize = (w: number) => Math.round(w * TRACK.colorSteps) / TRACK.colorSteps;

/** Az azonos súlyú, végpontban találkozó szakaszok egy vonallá: sima illesztés, kevés elem. */
function chain(items: readonly { a: [number, number]; b: [number, number]; weight: number; grey: boolean; rank: number }[]): HeatLine[] {
  const key = (c: readonly [number, number], w: number, g: boolean) => `${roundKey(c[0])},${roundKey(c[1])}|${w}|${g}`;
  const free = new Map<string, number[]>();
  const push = (k: string, i: number) => {
    const l = free.get(k);
    if (l) l.push(i);
    else free.set(k, [i]);
  };
  items.forEach((s, i) => {
    push(key(s.a, s.weight, s.grey), i);
    push(key(s.b, s.weight, s.grey), i);
  });
  const used = new Array<boolean>(items.length).fill(false);
  const lines: { line: HeatLine; rank: number }[] = [];
  const nextFrom = (c: readonly [number, number], w: number, g: boolean): number | null => {
    const l = free.get(key(c, w, g));
    while (l && l.length > 0) {
      const i = l[l.length - 1]!;
      if (!used[i]) return i;
      l.pop();
    }
    return null;
  };
  items.forEach((s, i) => {
    if (used[i]) return;
    used[i] = true;
    const coords: [number, number][] = [s.a, s.b];
    let rank = s.rank;
    for (let dir = 0; dir < 2; dir++) {
      let tip = dir === 0 ? s.b : s.a;
      for (;;) {
        const j = nextFrom(tip, s.weight, s.grey);
        if (j === null) break;
        used[j] = true;
        const n = items[j]!;
        const nextTip = key(n.a, s.weight, s.grey) === key(tip, s.weight, s.grey) ? n.b : n.a;
        if (dir === 0) coords.push(nextTip);
        else coords.unshift(nextTip);
        rank = Math.max(rank, n.rank);
        tip = nextTip;
      }
    }
    lines.push({ line: { coords, weight: s.weight, grey: s.grey }, rank });
  });
  return lines.sort((x, y) => y.rank - x.rank).slice(0, TRACK.maxLines).map((x) => x.line);
}

const paddedBox = (b: HeatViewport['bbox']) => {
  const dLat = (b.north - b.south) * HEAT.viewPad;
  const dLon = (b.east - b.west) * HEAT.viewPad;
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLon, east: b.east + dLon };
};
const inBox = (c: readonly [number, number], b: HeatViewport['bbox']) => c[0] >= b.south && c[0] <= b.north && c[1] >= b.west && c[1] <= b.east;

/** A saját utak összesítése szakaszonként (a zónák és a mód csak kirajzoláskor számítanak); egy áthaladás is látszik. */
export class TrackIndex {
  private readonly segs = new Map<string, Agg>();

  get size(): number {
    return this.segs.size;
  }

  clear(): void {
    this.segs.clear();
  }

  add(lines: readonly TrackLine[]): void {
    for (const s of trackSegments(lines)) {
      const o = this.segs.get(s.key);
      if (o) {
        if (!s.nearEnd) {
          o.count++;
          o.sum += s.kmh;
        }
      } else this.segs.set(s.key, { a: s.a, b: s.b, count: s.nearEnd ? 0 : 1, sum: s.nearEnd ? 0 : s.kmh, mid: midOf(s.a, s.b) });
    }
  }

  /** A látható vonalak (kis ráhagyással): a zónán belüli és a csak út-végi szakasz szürke. */
  lines(vp: HeatViewport, view: HeatView, zones: readonly HeatZone[]): HeatLine[] {
    const box = paddedBox(vp.bbox);
    const items: { a: [number, number]; b: [number, number]; weight: number; grey: boolean; rank: number }[] = [];
    for (const s of this.segs.values()) {
      if (!inBox(s.a, box) && !inBox(s.b, box)) continue;
      const grey = s.count === 0 || (zones.length > 0 && inZone(s.mid, zones, TRACK.zoneMarginM));
      items.push({ a: s.a, b: s.b, grey, weight: grey ? 0 : quantize(heatWeight({ count: s.count, avgKmh: s.sum / s.count }, view)), rank: s.count });
    }
    return chain(items);
  }
}

/** A közösségi sorok vonalakká. */
export function globalLines(rows: readonly SegmentGlobalRow[], view: HeatView): HeatLine[] {
  return chain(rows.map((r) => ({ a: [r.lat1, r.lon1] as [number, number], b: [r.lat2, r.lon2] as [number, number], grey: false, weight: quantize(heatWeight({ count: r.count, avgKmh: r.avg_speed }, view)), rank: r.count })));
}

/** A közösségi nézet sorai a saját szakaszokból (szimulátor, `?heatSeed`): mintha ≥ 3 beküldés lenne. */
export function seedGlobalRows(lines: readonly TrackLine[][]): SegmentGlobalRow[] {
  const out = new Map<string, SegmentGlobalRow>();
  for (const l of lines) {
    for (const s of trackSegments(l)) {
      if (!s.matched) continue;
      const o = out.get(s.key);
      if (o) {
        o.avg_speed = (o.avg_speed * o.count + s.kmh) / (o.count + 1);
        o.count++;
      } else out.set(s.key, { seg_key: s.key, lat1: s.a[0], lon1: s.a[1], lat2: s.b[0], lon2: s.b[1], count: 1, avg_speed: s.kmh });
    }
  }
  return [...out.values()];
}
