import { angleDiffDeg, bearingDeg, haversineM, type LatLon } from '@atlagsebesseg/core';
import { HEAT, heatWeight, inZone, type HeatView, type HeatZone, type HeatViewport } from './heat';
import { simplifyPath, TRIP, type TripSample } from './trips';

/**
 * AW24: hőtérkép utcákra illesztett csíkokkal (a rácscellák helyett). Platformfüggetlen; a Swift-pár: `Logic/Track.swift`, azonos nevű tesztekkel
 * (`track.test.ts` ↔ `TrackTests.swift`), közös fixtúrán (`fixtures/track-budapest.json`).
 *
 * Út végén: minták → pontsor (`recordTrace`) → egyszerűsítés (`simplifyForMatch`) → darabolás (`matchChunks`) → illesztő (`MapMatcher`, cserélhető) → vonalak
 * (`assembleLines`) → útszakaszok (`trackSegments`). Ahol az illesztés nem sikerül vagy kerülőt adna, a nyers pontok közti egyenes marad; a GPS-kiesésnél a csík megszakad.
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
  /** Illesztés előtti egyszerűsítés (Douglas–Peucker, m). */
  simplifyM: 6,
  /** Egyszerűsítés után sem maradhat ennél nagyobb hézag (m): a ritka pontok közt az illesztő másik utat választhat. */
  maxSpacingM: 400,
  /** A Map Matching kérésenkénti pontkorlátja. */
  matchMaxCoords: 100,
  /** Az illesztési sugár a pont pontosságából, ezek közé szorítva (m; a Map Matching felső határa 50). */
  radiusMinM: 10,
  radiusMaxM: 50,
  /** Ennél gyengébb bizalmú illesztés nem számít (0…1). */
  minConfidence: 0.1,
  /** Kerülő-őr: az illesztett darab hossza a két pont légvonalához képest (tilos megfordulásnál az illesztő körbevinné az utcán). */
  detourFactor: 2,
  detourExtraM: 150,
  /** Megfordulás a pontsorban (fok): itt új illesztési kérés indul, a két irány egymástól függetlenül illeszkedik, köztük nincs körbevezetés. */
  reversalDeg: 135,
  /** Az útszakaszok hossza az illesztett vonal mentén (m). */
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

/** Az illesztő szolgáltatót jelöli az eredményen: a Mapbox-eredmény így külön törölhető, ha saját illesztőre váltunk. */
export const MATCHER_MAPBOX = 'mapbox';

export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  kmh: number | null;
  acc: number | null;
}

/** Egy összefüggő vonaldarab: `matched` az úthálózatra illesztett, különben a nyers pontok közti egyenes. */
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

/** Egyenes szakaszon kevesebb pont az illesztés előtt (a kanyarok és a megfordulás megmaradnak); `maxSpacingM`-nél nagyobb hézag nem marad. */
export function simplifyForMatch(points: readonly TrackPoint[]): TrackPoint[] {
  if (points.length <= 2) return [...points];
  const kept = new Set(simplifyPath(points as readonly LatLon[], TRACK.simplifyM));
  const out: TrackPoint[] = [];
  let lastI = 0;
  points.forEach((p, i) => {
    if (kept.has(p)) {
      if (i > 0) {
        // a nagy hézagba az eredeti pontokból kerül vissza
        let from = lastI;
        for (let k = lastI + 1; k < i; k++) {
          if (haversineM(points[from]!, points[k + 1]!) > TRACK.maxSpacingM) {
            out.push(points[k]!);
            from = k;
          }
        }
      }
      out.push(p);
      lastI = i;
    }
  });
  return out;
}

/** Darabolás a kérésenkénti pontkorlát szerint; a szomszédos darabok egy pontot közösen tartalmaznak, így a vonal nem szakad el. */
export function matchChunks(points: readonly TrackPoint[], max: number = TRACK.matchMaxCoords): TrackPoint[][] {
  if (points.length <= max) return points.length >= 2 ? [[...points]] : [];
  const out: TrackPoint[][] = [];
  for (let i = 0; i < points.length - 1; i += max - 1) out.push(points.slice(i, i + max));
  return out;
}

/** A kérésekre bontás: a megfordulásnál mindig új kérés indul (egy tilos megfordulás különben a teljes darab illesztését lerontja), azon belül a pontkorlát szerint. */
export function traceChunks(points: readonly TrackPoint[]): TrackPoint[][] {
  const out: TrackPoint[][] = [];
  let from = 0;
  for (let i = 1; i < points.length - 1; i++) {
    if (reversalAt(points, i)) {
      out.push(...matchChunks(points.slice(from, i + 1)));
      from = i;
    }
  }
  out.push(...matchChunks(points.slice(from)));
  return out;
}

/** Az illesztési sugár a pont pontosságából (ismeretlen pontosságnál a tartomány közepe). */
export const matchRadius = (acc: number | null): number => Math.round(Math.max(TRACK.radiusMinM, Math.min(TRACK.radiusMaxM, acc === null ? (TRACK.radiusMinM + TRACK.radiusMaxM) / 2 : acc * 1.5)));

/** A Mapbox Map Matching kérése (`driving`, teljes GeoJSON-geometria; a sugár a pontosságból, az időbélyeg szigorúan növekvő). */
export function mapboxMatchUrl(points: readonly TrackPoint[], token: string): string {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  let last = 0;
  const stamps = points.map((p) => {
    last = Math.max(Math.floor(p.t / 1000), last + 1);
    return String(last);
  });
  const q = new URLSearchParams({ geometries: 'geojson', overview: 'full', steps: 'false', tidy: 'false', radiuses: points.map((p) => matchRadius(p.acc)).join(';'), timestamps: stamps.join(';') });
  q.set('access_token', token);
  return `https://api.mapbox.com/matching/v5/mapbox/driving/${coords}?${q}`;
}

/** Az illesztő válasza közös alakban; más szolgáltató (OSRM, Valhalla) ugyanezt adja a `MapMatcher` mögött. */
export interface MatchResult {
  /** `legsM`: a szomszédos illesztett pontok közti táv a vonal mentén (m): ezzel ugyanaz az utca oda-vissza sem téveszthető össze. */
  matchings: { confidence: number; coords: [number, number][]; legsM: number[] }[];
  /** Pontonként (a kérés sorrendjében): melyik illesztéshez tartozik és hova került; `null`: nem illeszthető. */
  tracepoints: ({ matching: number; lat: number; lon: number } | null)[];
}

/** Cserélhető illesztő-réteg (ma Mapbox, később saját szerver). Hálózati hiba: kivétel (az út később újrapróbálódik); „nincs illesztés”: üres eredmény. */
export interface MapMatcher {
  readonly id: string;
  match(points: readonly TrackPoint[]): Promise<MatchResult>;
}

const EMPTY_MATCH = (n: number): MatchResult => ({ matchings: [], tracepoints: new Array(n).fill(null) });

/** A Map Matching válasz feldolgozása; a `NoMatch` és társai üres eredmény, nem hiba. */
export function parseMapboxMatch(json: unknown, n: number): MatchResult {
  const j = json as { code?: string; matchings?: { confidence?: number; geometry?: { coordinates?: [number, number][] }; legs?: { distance?: number }[] }[]; tracepoints?: ({ matchings_index?: number; location?: [number, number] } | null)[] } | null;
  if (!j || j.code !== 'Ok' || !Array.isArray(j.matchings) || !Array.isArray(j.tracepoints)) return EMPTY_MATCH(n);
  return {
    matchings: j.matchings.map((m) => ({ confidence: m.confidence ?? 0, coords: (m.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as [number, number]), legsM: (m.legs ?? []).map((l) => l.distance ?? 0) })),
    tracepoints: j.tracepoints.map((t) => (t && typeof t.matchings_index === 'number' && t.location ? { matching: t.matchings_index, lat: t.location[1], lon: t.location[0] } : null)),
  };
}

/** Mapbox-illesztő; a `fetchFn` a tesztben és a felvételnél cserélhető. */
export function mapboxMatcher(token: string, fetchFn: typeof fetch = fetch): MapMatcher {
  return {
    id: MATCHER_MAPBOX,
    async match(points) {
      const r = await fetchFn(mapboxMatchUrl(points, token));
      // a 422 (nem illeszthető bemenet) nem ismételhető: egyenes vonalak; a többi hiba később újrapróbálódik
      if (r.status === 422) return EMPTY_MATCH(points.length);
      if (!r.ok) throw new Error(`matching http_${r.status}`);
      return parseMapboxMatch(await r.json(), points.length);
    },
  };
}

/** A vonal darabja két, a vonal mentén mért távolság között. */
function sliceByDistance(line: readonly [number, number][], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let run = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const d = distance(a, b);
    const next = run + d;
    const pointAt = (m: number): [number, number] => (d === 0 ? [a[0], a[1]] : [a[0] + ((b[0] - a[0]) * (m - run)) / d, a[1] + ((b[1] - a[1]) * (m - run)) / d]);
    if (out.length === 0 && next >= from) out.push(pointAt(Math.max(from, run)));
    if (next >= to) {
      out.push(pointAt(Math.min(to, next)));
      return out;
    }
    if (out.length > 0 && next > from) out.push([b[0], b[1]]);
    run = next;
  }
  return out;
}

const lengthOf = (c: readonly [number, number][]) => c.slice(1).reduce((sum, x, i) => sum + distance(c[i]!, x), 0);

/** Megfordul-e a pontsor az `i`. pontnál. */
function reversalAt(points: readonly TrackPoint[], i: number): boolean {
  const a = points[i - 1];
  const b = points[i];
  const c = points[i + 1];
  if (!a || !b || !c) return false;
  return angleDiffDeg(bearingDeg(a, b), bearingDeg(b, c)) >= TRACK.reversalDeg;
}

/**
 * A vonalak az illesztésből: két egymás utáni pont közt az illesztett darab, ha mindkettő ugyanabban az (elég biztos) illesztésben van és a darab nem kerülő; különben a nyers
 * egyenes (tilosban fordulás, parkoló, illesztési hiba). `chunks` és `results` párban; a vonal nem szakad el, csak a darabok (GPS-kiesés) között.
 */
export function assembleLines(chunks: readonly (readonly TrackPoint[])[], results: readonly MatchResult[]): TrackLine[] {
  const out: TrackLine[] = [];
  let cur: TrackLine | null = null;
  const put = (matched: boolean, coords: [number, number][], kmhA: number, kmhB: number) => {
    const total = lengthOf(coords);
    let run = 0;
    const speeds = coords.map((c, i) => {
      if (i > 0) run += distance(coords[i - 1]!, c);
      return total > 0 ? kmhA + ((kmhB - kmhA) * run) / total : kmhA;
    });
    if (cur && cur.matched === matched) {
      const skip = distance(cur.coords.at(-1)!, coords[0]!) < 0.01 ? 1 : 0;
      cur.coords.push(...coords.slice(skip));
      cur.kmh.push(...speeds.slice(skip));
    } else {
      // az előző darab végéhez kötve: a váltásnál sincs rés
      const joint = cur?.coords.at(-1);
      const head: [number, number][] = joint && distance(joint, coords[0]!) >= 0.01 ? [joint] : [];
      cur = { matched, coords: [...head, ...coords], kmh: [...head.map(() => kmhA), ...speeds] };
      out.push(cur);
    }
  };
  chunks.forEach((points, ci) => {
    const r = results[ci] ?? EMPTY_MATCH(points.length);
    const ordinals = new Map<number, number>();
    const tp = (i: number) => r.tracepoints[i] ?? null;
    /** A pont sorszáma az illesztésén belül (a `legsM` szerinti hely). */
    const ordinalAt: (number | null)[] = points.map((_, i) => {
      const t = tp(i);
      if (!t) return null;
      const n = ordinals.get(t.matching) ?? 0;
      ordinals.set(t.matching, n + 1);
      return n;
    });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const ta = tp(i);
      const tb = tp(i + 1);
      const m = ta && tb && ta.matching === tb.matching ? r.matchings[ta.matching] : undefined;
      const kA = a.kmh ?? 0;
      const kB = b.kmh ?? kA;
      let piece: [number, number][] | null = null;
      const n = ordinalAt[i];
      if (m && n !== null && n !== undefined && m.confidence >= TRACK.minConfidence && m.coords.length >= 2 && n < m.legsM.length) {
        // a leg-távok és a geometria hossza kerekítésben eltér: arányosan a vonal hosszára
        const legsTotal = m.legsM.reduce((s, x) => s + x, 0);
        const scale = legsTotal > 0 ? lengthOf(m.coords) / legsTotal : 1;
        const from = m.legsM.slice(0, n).reduce((s, x) => s + x, 0) * scale;
        const legM = m.legsM[n]! * scale;
        const chord = haversineM(a, b);
        const limit = Math.max(chord * TRACK.detourFactor, chord + TRACK.detourExtraM);
        if (legM <= limit) {
          const c = sliceByDistance(m.coords, from, from + legM);
          if (c.length >= 2 && legM > 0) piece = c;
        }
      }
      if (piece) put(true, piece, kA, kB);
      else put(false, [ta ? [ta.lat, ta.lon] : [a.lat, a.lon], tb ? [tb.lat, tb.lon] : [b.lat, b.lon]], kA, kB);
    }
  });
  return out;
}

/** Illesztő nélkül (szimulátor, token nélkül): a nyers pontok egyenesei, a kiesésnél megszakítva. */
export function rawLines(parts: readonly (readonly TrackPoint[])[]): TrackLine[] {
  return parts.filter((p) => p.length >= 2).map((p) => ({ matched: false, coords: p.map((x) => [x.lat, x.lon] as [number, number]), kmh: p.map((x) => x.kmh ?? 0) }));
}

/** Teljes illesztés: darabonként egyszerűsít, darabol, illeszt; a darabok (GPS-kiesés) külön vonalak maradnak, soha nem kötődnek össze. */
export async function matchTrace(parts: readonly (readonly TrackPoint[])[], matcher: MapMatcher): Promise<TrackLine[]> {
  const out: TrackLine[] = [];
  for (const part of parts) {
    if (part.length < 2) continue;
    const chunks = traceChunks(simplifyForMatch(part));
    const results: MatchResult[] = [];
    for (const c of chunks) results.push(await matcher.match(c));
    out.push(...assembleLines(chunks, results));
  }
  return out;
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
