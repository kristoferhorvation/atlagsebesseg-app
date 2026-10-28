/**
 * Tervezett mérések helymeghatározása az OSM-en (A7). A hely mindig egy vagy több vonal:
 *  - település + útszám → az út azon része, ami a település közigazgatási határán belül fut
 *    (admin_level=8; Budapesten a kerület, admin_level=9);
 *  - település + utca → az utca vonala a településen belül;
 *  - kereszteződés → mindkét ág a csomópont 300 m-es körzetében;
 *  - útszám + km-szelvény (település nélkül) → az út a km-kövek (highway=milestone) között.
 * Ami nem illeszthető biztosan, kimarad okkal.
 */
import { haversineM, LocalProjection, type LatLon } from '@atlagsebesseg/core';
import type { OsmNode, OsmRelationMember, OsmWay, OverpassResponse } from '../overpass';
import { parseMaxspeed } from '../convert';
import { streetMatches, streetMatchesLoose, type KmRange, type PlannedLine } from './parse';

/** Kereszteződésnél a csomópont körüli sugár. */
export const JUNCTION_RADIUS_M = 300;
/** Km-kőnek ennyire kell lennie az úttól, hogy az úthoz tartozzon. */
export const MILESTONE_ON_ROAD_M = 25;
/** Egy km-kő körül ekkora a vonal, ha csak az egyik szomszédos kő van meg (a ±0,5 km biztosan benne van). */
export const MILESTONE_RADIUS_M = 600;
/** A vonalakat ilyen sűrűn mintavételezzük a vágás előtt. */
const DENSIFY_M = 20;

export interface AdminArea {
  /** OSM-relációazonosító. */
  relId: number;
  name: string;
  /** A határ gyűrűi (külső és belső), ha a lekérés geometriát is adott. */
  rings?: { outer: LatLon[][]; inner: LatLon[][] };
}

export const areaId = (relId: number) => 3600000000 + relId;

/** Egy megye települései (Budapesten a kerületei) a határuk geometriájával. */
export function settlementsQuery(countyOsmName: string): string {
  const level = countyOsmName === 'Budapest' ? 9 : 8;
  return `[out:json][timeout:180];
area["ISO3166-1"="HU"][admin_level=2]->.hu;
rel(area.hu)["boundary"="administrative"]["admin_level"="6"]["name"="${countyOsmName}"]->.c;
.c out ids tags;
.c map_to_area->.ca;
rel(area.ca)["boundary"="administrative"]["admin_level"="${level}"];
out geom;`;
}

export interface CountyAreas {
  county: AdminArea;
  /** név → terület (Budapesten a kerület neve: „IV. kerület”). */
  areas: Map<string, AdminArea>;
}

export function parseSettlements(res: OverpassResponse, countyOsmName: string): CountyAreas | null {
  const rels = res.elements.filter((e) => e.type === 'relation');
  const c = rels.find((e) => e.tags?.name === countyOsmName && e.tags?.admin_level === '6');
  if (!c) return null;
  const areas = new Map<string, AdminArea>();
  for (const r of rels) if (r !== c && r.tags?.name) areas.set(r.tags.name, { relId: r.id, name: r.tags.name, rings: assembleRings(r) });
  return { county: { relId: c.id, name: countyOsmName }, areas };
}

/** A reláció külső/belső gyűrűi a tag-utak összefűzésével (közös végpontokon). */
export function assembleRings(rel: { members: readonly OsmRelationMember[] }): { outer: LatLon[][]; inner: LatLon[][] } {
  const build = (role: string) => {
    const segs = rel.members
      .filter((m) => m.type === 'way' && (m.role === role || (role === 'outer' && m.role === '')) && (m.geometry?.length ?? 0) >= 2)
      .map((m) => m.geometry!.map((g) => ({ lat: g.lat, lon: g.lon })));
    const rings: LatLon[][] = [];
    const same = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
    while (segs.length) {
      const ring = segs.shift()!;
      let grown = true;
      while (!same(ring[0]!, ring[ring.length - 1]!) && grown) {
        grown = false;
        for (let i = 0; i < segs.length; i++) {
          const sg = segs[i]!;
          const end = ring[ring.length - 1]!;
          if (same(sg[0]!, end)) ring.push(...sg.slice(1));
          else if (same(sg[sg.length - 1]!, end)) ring.push(...[...sg].reverse().slice(1));
          else continue;
          segs.splice(i, 1);
          grown = true;
          break;
        }
      }
      if (ring.length >= 4) rings.push(ring);
    }
    return rings;
  };
  return { outer: build('outer'), inner: build('inner') };
}

function inRing(p: LatLon, ring: readonly LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** A pont a terület határán belül van-e (külső gyűrűben, de nem belsőben). */
export function pointInArea(p: LatLon, area: AdminArea): boolean {
  const r = area.rings;
  if (!r) return false;
  return r.outer.some((ring) => inRing(p, ring)) && !r.inner.some((ring) => inRing(p, ring));
}

// ---------------------------------------------------------------------------
// Zóna: a település közigazgatási határa
// ---------------------------------------------------------------------------

export type ZoneGeometry =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] };

/** A zóna határának egyszerűsítési tűrése: a térképen ennyi eltérés nem látszik, a sor viszont töredék méretű. */
export const ZONE_SIMPLIFY_M = 25;

/** Douglas–Peucker egy zárt gyűrűre (helyi, méteres vetületben); a végpontok maradnak. */
export function simplifyRing(ring: readonly LatLon[], tolM = ZONE_SIMPLIFY_M): LatLon[] {
  const open = ring.length > 1 && ring[0]!.lat === ring[ring.length - 1]!.lat && ring[0]!.lon === ring[ring.length - 1]!.lon ? ring.slice(0, -1) : [...ring];
  if (open.length <= 3) return [...open, open[0]!];
  const proj = new LocalProjection(open[0]!);
  const xy = open.map((p) => proj.toXY(p));
  const keep = new Array<boolean>(open.length).fill(false);
  keep[0] = true;
  keep[open.length - 1] = true;
  const stack: [number, number][] = [[0, open.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const dx = xy[b]!.x - xy[a]!.x;
    const dy = xy[b]!.y - xy[a]!.y;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farD = tolM;
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs(dy * (xy[i]!.x - xy[a]!.x) - dx * (xy[i]!.y - xy[a]!.y)) / len : Math.hypot(xy[i]!.x - xy[a]!.x, xy[i]!.y - xy[a]!.y);
      if (d > farD) [far, farD] = [i, d];
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  const out = open.filter((_, i) => keep[i]);
  return out.length >= 3 ? [...out, out[0]!] : [...open, open[0]!];
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const coords = (ring: readonly LatLon[]) => ring.map((p) => [round6(p.lon), round6(p.lat)] as [number, number]);

/**
 * A település határa GeoJSON-sokszögként: a külső gyűrűk egyszerűsítve, a belső gyűrűk (lyukak)
 * ahhoz a külső gyűrűhöz, amely tartalmazza őket. `null`, ha a határ geometriája nem áll rendelkezésre.
 */
export function areaZone(area: AdminArea): ZoneGeometry | null {
  const r = area.rings;
  if (!r?.outer.length) return null;
  const polys = r.outer.map((outer) => ({ outer, holes: [] as LatLon[][] }));
  for (const hole of r.inner) {
    const home = polys.find((p) => inRing(hole[0]!, p.outer));
    if (home) home.holes.push(hole);
  }
  const rings = polys.map((p) => [p.outer, ...p.holes].map((g) => coords(simplifyRing(g))));
  return rings.length === 1 ? { type: 'Polygon', coordinates: rings[0]! } : { type: 'MultiPolygon', coordinates: rings };
}

/** A zóna befoglaló téglalapja. */
export function zoneBbox(z: ZoneGeometry): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const pts = (z.type === 'Polygon' ? [z.coordinates] : z.coordinates).flatMap((p) => p[0]!);
  return {
    minLat: Math.min(...pts.map((p) => p[1]!)),
    minLng: Math.min(...pts.map((p) => p[0]!)),
    maxLat: Math.max(...pts.map((p) => p[1]!)),
    maxLng: Math.max(...pts.map((p) => p[0]!)),
  };
}

/** A megye útjai a kért utcanevek első szava és az útszámok szerint (egy lekérés a megye összes helyszínére). */
export function countyWaysQuery(county: AdminArea, streets: readonly string[], roads: readonly string[]): string {
  const parts: string[] = [];
  const first = [...new Set(streets.map((s) => s.split(' ')[0]!.replace(/\.$/, '')).filter(Boolean))];
  if (first.length) parts.push(`way(area.c)["highway"]["name"~"^(${first.map(escapeRe).join('|')})",i];`);
  if (roads.length) parts.push(`way(area.c)["highway"]["ref"~"(^|;) *(${roads.map(escapeRe).join('|')}) *(;|$)"];`);
  return `[out:json][timeout:180];
area(id:${areaId(county.relId)})->.c;
(
${parts.join('\n')}
);
out body geom;`;
}

/**
 * A megyei út-válaszból egy település „saját” válasza: az utak + a határon belüli csomópontok
 * (ugyanaz az alak, mint a településenkénti lekérésé – a `locateInSettlement` ezt várja).
 */
export function settlementSubset(res: OverpassResponse, area: AdminArea): OverpassResponse {
  const r = area.rings;
  if (!r?.outer.length) return { elements: [] };
  const pts = r.outer.flat();
  const box = { s: Math.min(...pts.map((p) => p.lat)), n: Math.max(...pts.map((p) => p.lat)), w: Math.min(...pts.map((p) => p.lon)), e: Math.max(...pts.map((p) => p.lon)) };
  const ways: OsmWay[] = [];
  const inside = new Set<number>();
  for (const w of res.elements) {
    if (w.type !== 'way' || !w.geometry) continue;
    let any = false;
    w.geometry.forEach((g, i) => {
      if (g.lat < box.s || g.lat > box.n || g.lon < box.w || g.lon > box.e) return;
      if (pointInArea(g, area)) {
        inside.add(w.nodes[i]!);
        any = true;
      }
    });
    if (any) ways.push(w);
  }
  return { elements: [...ways, ...[...inside].map((id): OsmNode => ({ type: 'node', id, lat: 0, lon: 0 }))] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');

/** Egy út a megyében + a mellette álló km-kövek. */
export function roadMilestonesQuery(county: AdminArea, road: string): string {
  return `[out:json][timeout:120];
area(id:${areaId(county.relId)})->.c;
way(area.c)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"]["ref"~"(^|;) *${escapeRe(road)} *(;|$)"]->.w;
.w out body geom;
node(around.w:${MILESTONE_ON_ROAD_M})["highway"="milestone"];
out body;`;
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

export interface Part {
  /** A vonal pontjai. */
  points: LatLon[];
  /** Csomópont-azonosítók a két végén (láncoláshoz; vágott végnél negatív, egyedi). */
  startId: number;
  endId: number;
  tags: Record<string, string>;
}

const lengthOf = (pts: readonly LatLon[]) => pts.reduce((s, p, i) => (i ? s + haversineM(pts[i - 1]!, p) : 0), 0);

/** Egy út csomópont-futamai, amelyek a halmazban vannak (a település határán belül). */
export function insideRuns(way: OsmWay, inside: ReadonlySet<number>): Part[] {
  const out: Part[] = [];
  const g = way.geometry ?? [];
  let cur: { pts: LatLon[]; ids: number[] } | null = null;
  const flush = () => {
    if (cur && cur.pts.length >= 2) out.push({ points: cur.pts, startId: cur.ids[0]!, endId: cur.ids[cur.ids.length - 1]!, tags: way.tags ?? {} });
    cur = null;
  };
  way.nodes.forEach((id, i) => {
    const p = g[i];
    if (!p || !inside.has(id)) return flush();
    cur ??= { pts: [], ids: [] };
    cur.pts.push({ lat: p.lat, lon: p.lon });
    cur.ids.push(id);
  });
  flush();
  return out;
}

let cutSeq = -1;

/** Sűrítés, majd a feltételnek megfelelő pontok futamai (a vágott végek új, negatív azonosítót kapnak). */
export function clipParts(parts: readonly Part[], keep: (p: LatLon) => boolean): Part[] {
  const out: Part[] = [];
  for (const part of parts) {
    const dense = densify(part.points, DENSIFY_M);
    let run: LatLon[] = [];
    let runStart = 0;
    const flush = (endIdx: number) => {
      if (run.length >= 2) {
        out.push({
          points: run,
          startId: runStart === 0 ? part.startId : cutSeq--,
          endId: endIdx === dense.length - 1 ? part.endId : cutSeq--,
          tags: part.tags,
        });
      }
      run = [];
    };
    dense.forEach((p, i) => {
      if (keep(p)) {
        if (!run.length) runStart = i;
        run.push(p);
        if (i === dense.length - 1) flush(i);
      } else if (run.length) flush(i - 1);
    });
  }
  return out;
}

export function densify(points: readonly LatLon[], stepM: number): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i > 0) {
      const a = points[i - 1]!;
      const n = Math.floor(haversineM(a, p) / stepM);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push({ lat: a.lat + (p.lat - a.lat) * t, lon: a.lon + (p.lon - a.lon) * t });
      }
    }
    out.push(p);
  }
  return out;
}

/** A közös végpontú darabok összefűzése hosszabb vonalakká (az irány nem számít). */
export function chainParts(parts: readonly Part[]): Part[] {
  const pool = parts.map((p) => ({ ...p, points: [...p.points] }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pool.length; i++) {
      for (let j = 0; j < pool.length; j++) {
        if (i === j) continue;
        const a = pool[i]!;
        const b = pool[j]!;
        // csak valódi (nem vágott, ≥ 0) csomóponton fűzünk
        if (a.endId === b.startId && a.endId >= 0) {
          a.points.push(...b.points.slice(1));
          a.endId = b.endId;
        } else if (a.endId === b.endId && a.endId >= 0) {
          a.points.push(...[...b.points].reverse().slice(1));
          a.endId = b.startId;
        } else if (a.startId === b.startId && a.startId >= 0) {
          a.points.unshift(...[...b.points].reverse().slice(0, -1));
          a.startId = b.endId;
        } else continue;
        pool.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Sebességhatár
// ---------------------------------------------------------------------------

/** Az OSM maxspeed-érték km/h-ban; a magyar jogszabályi alapértékek („HU:urban”) is. */
export function maxspeedKmh(v: string | undefined): number | null {
  if (!v) return null;
  const implicit: Record<string, number> = { 'HU:urban': 50, 'HU:rural': 90, 'HU:trunk': 110, 'HU:motorway': 130, 'HU:living_street': 20 };
  if (v in implicit) return implicit[v]!;
  const n = parseMaxspeed(v);
  return n !== null && n >= 5 && n <= 250 ? Math.round(n) : null;
}

/**
 * A vonal mentén leggyakoribb maxspeed (hossz szerint súlyozva; döntetlennél a kisebb). Ha egyik
 * darabon sincs, `null` – a hívó a KRESZ-alapértékre vált.
 */
export function pickMaxspeed(parts: readonly Part[]): number | null {
  const byValue = new Map<number, number>();
  for (const p of parts) {
    const t = p.tags;
    let v = maxspeedKmh(t.maxspeed);
    if (v === null && t['maxspeed:forward'] && t['maxspeed:forward'] === t['maxspeed:backward']) v = maxspeedKmh(t['maxspeed:forward']);
    if (v === null) continue;
    byValue.set(v, (byValue.get(v) ?? 0) + lengthOf(p.points));
  }
  let best: number | null = null;
  let bestLen = -1;
  for (const [v, len] of byValue) if (len > bestLen + 1e-6 || (Math.abs(len - bestLen) <= 1e-6 && best !== null && v < best)) [best, bestLen] = [v, len];
  return best;
}

/**
 * KRESZ-alapérték az út típusából: autópálya 130, autóút 110, lakó-pihenő övezet 20, lakott
 * területen belül 50, kívül 90. A „lakott terület” a forrásból jön (házszám, „lakott területen
 * belül”), utcánál (nem számozott út) 50; ismeretlenül számozott úton 90.
 */
export function kreszDefault(parts: readonly Part[], builtUp: boolean | null, isStreet: boolean): number {
  const hw = mostCommonByLength(parts, (t) => t.highway);
  if (hw === 'motorway' || hw === 'motorway_link') return 130;
  if (parts.some((p) => p.tags.motorroad === 'yes')) return 110;
  if (hw === 'living_street') return 20;
  if (builtUp === true) return 50;
  if (builtUp === false) return 90;
  if (isStreet || hw === 'residential' || hw === 'service') return 50;
  return 90;
}

function mostCommonByLength(parts: readonly Part[], key: (t: Record<string, string>) => string | undefined): string | undefined {
  const m = new Map<string, number>();
  for (const p of parts) {
    const k = key(p.tags);
    if (k) m.set(k, (m.get(k) ?? 0) + lengthOf(p.points));
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// ---------------------------------------------------------------------------
// Helymeghatározás
// ---------------------------------------------------------------------------

export interface Located {
  lines: LatLon[][];
  parts: Part[];
  speedLimitKmh: number;
  limitSource: 'osm' | 'kresz_default';
}

export type LocateResult = { ok: true; located: Located } | { ok: false; reason: string };

const ways = (res: OverpassResponse) => res.elements.filter((e): e is OsmWay => e.type === 'way');
const nodeIds = (res: OverpassResponse) => new Set(res.elements.filter((e) => e.type === 'node').map((e) => e.id));

const refHas = (tags: Record<string, string> | undefined, road: string) =>
  (tags?.ref ?? '')
    .split(';')
    .map((r) => r.trim().toUpperCase())
    .includes(road.toUpperCase());

function finish(parts: Part[], line: PlannedLine): LocateResult {
  const chained = chainParts(parts).filter((p) => lengthOf(p.points) >= 30);
  if (!chained.length) return { ok: false, reason: 'a vonal 30 m-nél rövidebb a határon belül' };
  const osm = pickMaxspeed(chained);
  return {
    ok: true,
    located: {
      lines: chained.map((p) => p.points),
      parts: chained,
      speedLimitKmh: osm ?? kreszDefault(chained, line.builtUp, line.kind === 'street' || (line.kind === 'junction' && !line.road)),
      limitSource: osm !== null ? 'osm' : 'kresz_default',
    },
  };
}

/** Település + út / utca / kereszteződés – a település útjait tartalmazó Overpass-válaszból. */
export function locateInSettlement(line: PlannedLine, res: OverpassResponse): LocateResult {
  const all = ways(res);
  const inside = nodeIds(res);
  const runsFor = (pred: (w: OsmWay) => boolean) => all.filter(pred).flatMap((w) => insideRuns(w, inside));
  if (line.kind === 'road') {
    const parts = runsFor((w) => refHas(w.tags, line.road!) && !/_link$/.test(w.tags?.highway ?? ''));
    if (!parts.length) return { ok: false, reason: `a(z) ${line.road} út nem fut a település határán belül (OSM)` };
    return finish(parts, line);
  }
  if (line.kind === 'street') {
    const parts = streetRuns(line.streets[0]!, runsFor);
    if (typeof parts === 'string') return { ok: false, reason: parts };
    return finish(parts, line);
  }
  if (line.kind === 'junction') {
    const branches = [
      ...line.streets.map((s) => {
        const r = streetRuns(s, runsFor);
        return typeof r === 'string' ? [] : r;
      }),
      ...(line.road ? [runsFor((w) => refHas(w.tags, line.road!))] : []),
    ];
    const names = [...line.streets, ...(line.road ? [`${line.road} út`] : [])];
    const missing = branches.findIndex((b) => !b.length);
    if (missing >= 0) return { ok: false, reason: `a kereszteződés „${names[missing]}” ága nincs meg a településen (OSM)` };
    const ambiguous = line.streets.findIndex((s, i) => s.endsWith(' *') && new Set(branches[i]!.map((p) => p.tags.name)).size > 1);
    if (ambiguous >= 0) return { ok: false, reason: `„${line.streets[ambiguous]!.slice(0, -2)}” típusszó nélkül több utcára is illik a településen` };
    const junction = junctionPoint(branches[0]!, branches[1]!);
    if (!junction) return { ok: false, reason: `„${names[0]}” és „${names[1]}” nem keresztezi egymást (OSM)` };
    const near = (p: LatLon) => haversineM(p, junction) <= JUNCTION_RADIUS_M;
    return finish(clipParts([...branches[0]!, ...branches[1]!], near), line);
  }
  return { ok: false, reason: line.reason ?? 'nem értelmezhető helyszín' };
}

/**
 * Egy utca darabjai a településen: szigorú névegyezés; ha nincs, a lazább (pl. elhagyott
 * keresztnév), de csak ha pontosan egy ilyen nevű utca van – különben ok szövegként.
 */
function streetRuns(street: string, runsFor: (pred: (w: OsmWay) => boolean) => Part[]): Part[] | string {
  const strict = runsFor((w) => !!w.tags?.name && streetMatches(street, w.tags.name));
  if (strict.length) return strict;
  // második lépcső: elhagyott szó („Kossuth utca” ~ „Kossuth Lajos utca”), harmadik: más
  // utcatípus („Fő utca” ~ „Fő út”) – mindkettő csak egyértelmű (egyetlen nevű) találattal
  const anyType = street.endsWith(' *') ? null : `${street.split(' ').slice(0, -1).join(' ')} *`;
  for (const match of [(n: string) => streetMatchesLoose(street, n), ...(anyType ? [(n: string) => streetMatches(anyType, n)] : [])]) {
    const found = runsFor((w) => !!w.tags?.name && match(w.tags.name));
    const names = new Set(found.map((p) => p.tags.name));
    if (names.size > 1) return `„${street}” több utcára is illik a településen (${[...names].join(', ')})`;
    if (found.length) return found;
  }
  return `nincs „${street}” nevű út a településen (OSM)`;
}

/** A két ág közös pontja (közös csomópont, vagy 15 m-en belüli pontpár). */
export function junctionPoint(a: readonly Part[], b: readonly Part[]): LatLon | null {
  let best: LatLon | null = null;
  let bestD = 15;
  for (const pa of a)
    for (const p of pa.points)
      for (const pb of b)
        for (const q of pb.points) {
          const d = haversineM(p, q);
          if (d <= bestD) [best, bestD] = [p, d];
        }
  return best;
}

/**
 * Útszám + km-szelvény a megyében: a km-kövek alapján. Ha a szelvényt közrefogó két kő (⌊km⌋ és
 * ⌊km⌋+1) is megvan, a vonal a kettő közötti útszakasz; ha csak a legközelebbi egész km köve, a kő
 * körüli 600 m (a ±0,5 km biztosan benne van). Több azonos számú kő az úton (pl. két pályatest)
 * csak akkor elfogadható, ha 200 m-en belül vannak egymástól.
 */
export function locateByKm(line: PlannedLine, km: KmRange, res: OverpassResponse): LocateResult {
  const roadWays = ways(res).filter((w) => refHas(w.tags, line.road!));
  if (!roadWays.length) return { ok: false, reason: `a(z) ${line.road} út nincs meg a megyében (OSM)` };
  const stones = res.elements.filter((e): e is OsmNode => e.type === 'node' && e.tags?.highway === 'milestone');
  const parts: Part[] = roadWays.map((w) => ({
    points: (w.geometry ?? []).map((g) => ({ lat: g.lat, lon: g.lon })),
    startId: w.nodes[0]!,
    endId: w.nodes[w.nodes.length - 1]!,
    tags: w.tags ?? {},
  }));
  const at = (k: number): LatLon | null | 'ambiguous' => {
    const hits = stones.filter((s) => {
      const d = Number((s.tags?.distance ?? '').replace(',', '.'));
      return Number.isFinite(d) && Math.abs(d - k) < 1e-6 && nearRoad(s, parts);
    });
    if (!hits.length) return null;
    if (hits.some((h) => haversineM(h, hits[0]!) > 200)) return 'ambiguous';
    return { lat: hits.reduce((s, h) => s + h.lat, 0) / hits.length, lon: hits.reduce((s, h) => s + h.lon, 0) / hits.length };
  };
  const lo = Math.floor(km.from);
  const hi = km.to === km.from ? lo + 1 : Math.ceil(km.to);
  const a = at(lo);
  const b = at(hi);
  if (a === 'ambiguous' || b === 'ambiguous') return { ok: false, reason: `több ${lo}/${hi}. km-kő is van a(z) ${line.road} úton a megyében` };
  let keep: (p: LatLon) => boolean;
  if (a && b) {
    const span = haversineM(a, b);
    if (span > (hi - lo) * 1000 * 1.6 + 300) return { ok: false, reason: `a ${lo}. és ${hi}. km-kő távolsága (${Math.round(span)} m) nem illik a szelvényhez` };
    keep = (p) => haversineM(p, a) + haversineM(p, b) <= span + 150;
  } else {
    const nearest = Math.round(km.from);
    const one = km.to === km.from ? at(nearest) : null;
    if (!one || one === 'ambiguous') return { ok: false, reason: `nincs km-kő a(z) ${line.road} úton a ${km.from.toFixed(3).replace('.', '+')} szelvény körül (OSM)` };
    keep = (p) => haversineM(p, one) <= MILESTONE_RADIUS_M;
  }
  return finish(clipParts(parts, keep), line);
}

function nearRoad(p: LatLon, parts: readonly Part[]): boolean {
  const proj = new LocalProjection(p);
  for (const part of parts) {
    for (let i = 1; i < part.points.length; i++) {
      const a = proj.toXY(part.points[i - 1]!);
      const b = proj.toXY(part.points[i]!);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2)) : 0;
      if (Math.hypot(a.x + t * dx, a.y + t * dy) <= MILESTONE_ON_ROAD_M) return true;
    }
  }
  return false;
}

/** A vonalak befoglaló téglalapja. */
export function bboxOf(lines: readonly LatLon[][]): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const pts = lines.flat();
  return {
    minLat: Math.min(...pts.map((p) => p.lat)),
    minLng: Math.min(...pts.map((p) => p.lon)),
    maxLat: Math.max(...pts.map((p) => p.lat)),
    maxLng: Math.max(...pts.map((p) => p.lon)),
  };
}

