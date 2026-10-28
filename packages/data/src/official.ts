import { angleDiffDeg, bearingDeg, haversineM, LocalProjection, type LatLon, type Section, type SectionProvenance } from '@atlagsebesseg/core';
import { compass, parseMaxspeed } from './convert';
import type { RoadGraph } from './graph';
import { roundGeometry, routeBetween, simplifyGeometry, type Gate, type RouteBetween } from './routeBetween';

/**
 * Hivatalos listából származó tétel (egy irány), a kapuk helyével. Az import CSAK akkor veszi
 * fel, ha minden ellenőrzésen átmegy (`evaluateOfficial`); különben indokkal kimarad.
 */
export interface OfficialItem {
  /** Stabil azonosító, pl. "it-ps-a1-12" – a forrás saját azonosítójából, ha van. */
  id: string;
  country: string;
  /** A forrás szerinti útszám, pl. "A1", "S7", "DK1", "AP-7". */
  road: string;
  /** Emberi olvasásra, pl. "Bologna → Firenze". */
  direction: string;
  /** A tétel neve a kihagyás-listához (a forrás szóhasználatával). */
  label: string;
  start: Gate;
  end: Gate;
  /** A forrás szerinti határ; `null`, ha a forrás nem adja (akkor az OSM-ből, ha egyértelmű). */
  speedLimitKmh: number | null;
  /** A forrás szerinti hossz (m), ha van – ellenőrzésre és a végső hossznak. */
  officialLengthM?: number;
  provenance: SectionProvenance;
}

/** Egy kimaradt hivatalos tétel: név szerint, okkal (a zárójelentéshez). */
export interface OfficialSkip {
  id: string;
  label: string;
  reason: string;
}

export type OfficialResult = { ok: true; section: Section; note?: string } | { ok: false; skip: OfficialSkip };

/** Hossz-tartomány (m): ennél rövidebb / hosszabb szakasz nem reális. */
export const MIN_LENGTH_M = 500;
export const MAX_LENGTH_M = 50_000;
/** Az útvonal hosszának ennyi aránya (és legalább `LENGTH_TOLERANCE_MIN_M`) térhet el a hivatalostól. */
export const LENGTH_TOLERANCE = 0.15;
export const LENGTH_TOLERANCE_MIN_M = 400;
/** Az útvonal hosszának legalább ennyi része a megadott útszámon fusson. */
export const MIN_REF_SHARE = 0.8;
/** Az OSM-határ csak akkor elfogadott, ha az útvonal hosszának legalább ennyi részén ugyanaz. */
export const MIN_MAXSPEED_SHARE = 0.8;

/**
 * Útszám összehasonlítható alakban: nagybetű, szóköz és kötőjel nélkül; a lengyel országos és
 * vajdasági utak („DK7”, „DW132”) az OSM-ben csak számként szerepelnek („7”, „132”).
 */
export function normalizeRef(ref: string, country: string): string {
  let r = ref.toUpperCase().replace(/[\s\-.]/g, '');
  if (country === 'PL') r = r.replace(/^D[KW](?=\d)/, '');
  return r;
}

/** Az OSM `ref` (pl. "A22;E45") tartalmazza-e az útszámot. */
export function refMatches(road: string, osmRef: string | undefined, country: string): boolean {
  if (!osmRef) return false;
  const want = normalizeRef(road, country);
  return osmRef.split(/[;,]/).some((r) => normalizeRef(r, country) === want);
}

/** Az útvonal élei hosszal és az OSM-út címkéivel. */
function edges(graph: RoadGraph, route: RouteBetween): { lengthM: number; tags: Record<string, string> }[] {
  const g = route.geometry;
  const ways = route.path.wayIds;
  // a vonal pontjai: kezdőpont, belső csomópontok, végpont – az élek a `wayIds` sorrendjében
  if (ways.length === g.length - 1) {
    return ways.map((id, i) => ({ lengthM: haversineM(g[i]!, g[i + 1]!), tags: graph.ways.get(id)?.tags ?? {} }));
  }
  // (rövidített geometria: az 1 m-nél közelebbi pontok összevonva) – egyenletes elosztás
  const per = route.lengthM / Math.max(1, ways.length);
  return ways.map((id) => ({ lengthM: per, tags: graph.ways.get(id)?.tags ?? {} }));
}

/** A hossz azon része (0…1), amelyen az előrejelzés igaz. */
function share(es: { lengthM: number; tags: Record<string, string> }[], pred: (t: Record<string, string>) => boolean): number {
  const total = es.reduce((a, e) => a + e.lengthM, 0);
  return total > 0 ? es.filter((e) => pred(e.tags)).reduce((a, e) => a + e.lengthM, 0) / total : 0;
}

/** Az OSM-határ, ha az útvonal ≥ 80%-án egyezik; különben `null` (nem találgatunk). */
export function consistentMaxspeed(es: { lengthM: number; tags: Record<string, string> }[]): number | null {
  const byValue = new Map<number, number>();
  const total = es.reduce((a, e) => a + e.lengthM, 0);
  for (const e of es) {
    const v = parseMaxspeed(e.tags.maxspeed);
    if (v !== null) byValue.set(v, (byValue.get(v) ?? 0) + e.lengthM);
  }
  for (const [v, len] of byValue) if (total > 0 && len / total >= MIN_MAXSPEED_SHARE) return v;
  return null;
}

/**
 * Egy hivatalos tétel ellenőrzése az úthálózaton: irányhelyes útvonal a két kapu között (a kapuk
 * legfeljebb `snapRadiusM`-re az úttól), reális hossz (0,5–50 km, és a hivatalostól legfeljebb
 * 15%-kal / 400 m-rel eltérő), az útvonal ≥ 80%-a a megadott útszámon (OSM `ref`), határ a
 * forrásból vagy egyértelműen az OSM-ből. Bármelyik elbukik → kimarad, okkal.
 */
export function evaluateOfficial(item: OfficialItem, graph: RoadGraph, opts: { snapRadiusM?: number } = {}): OfficialResult {
  const skip = (reason: string): OfficialResult => ({ ok: false, skip: { id: item.id, label: item.label, reason } });
  const route = routeBetween(graph, item.start, item.end, { snapRadiusM: opts.snapRadiusM ?? 60 });
  if (typeof route === 'string') return skip(route);

  const len = route.lengthM;
  if (len < MIN_LENGTH_M || len > MAX_LENGTH_M) return skip(`irreális hossz: ${(len / 1000).toFixed(2)} km`);
  if (item.officialLengthM !== undefined) {
    const diff = Math.abs(len - item.officialLengthM);
    if (diff > Math.max(LENGTH_TOLERANCE * item.officialLengthM, LENGTH_TOLERANCE_MIN_M)) {
      return skip(`az útvonal ${(len / 1000).toFixed(2)} km, a hivatalos hossz ${(item.officialLengthM / 1000).toFixed(2)} km`);
    }
  }

  const es = edges(graph, route);
  const refShare = share(es, (t) => refMatches(item.road, t.ref, item.country));
  if (refShare < MIN_REF_SHARE) {
    return skip(`az útvonalnak csak ${Math.round(refShare * 100)}%-a fut a(z) ${item.road} úton (OSM ref)`);
  }

  let speedLimitKmh = item.speedLimitKmh;
  let note: string | undefined;
  if (speedLimitKmh === null) {
    speedLimitKmh = consistentMaxspeed(es);
    if (speedLimitKmh === null) return skip('a forrás nem adja a határt, és az OSM maxspeed sem egyértelmű');
    note = `határ az OSM-ből (${speedLimitKmh} km/h)`;
  }
  if (speedLimitKmh < 20 || speedLimitKmh > 200) return skip(`irreális határ: ${speedLimitKmh} km/h`);

  return {
    ok: true,
    note,
    section: {
      id: item.id,
      country: item.country,
      road: item.road,
      direction: item.direction || `→ ${compass(bearingDeg(item.start, item.end))}`,
      start: route.geometry[0]!,
      end: route.geometry[route.geometry.length - 1]!,
      lengthM: Math.round(item.officialLengthM ?? len),
      speedLimitKmh,
      source: 'hivatalos',
      verified: true,
      geometry: roundGeometry(simplifyGeometry(route.geometry)),
      provenance: item.provenance,
      limitSource: item.speedLimitKmh === null ? 'osm' : 'hivatalos',
    },
  };
}

/** Duplikátum: a geometria legalább ennyi része fed át (A6-szabály, CLAUDE.md). */
export const DUPLICATE_MIN_OVERLAP = 0.7;
/** Ennyi méteren belül számít átfedőnek egy pont (ugyanaz a pályatest). */
export const OVERLAP_TOLERANCE_M = 30;

function distToPolylineM(p: LatLon, line: readonly LatLon[]): number {
  const proj = new LocalProjection(p);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = proj.toXY(line[i - 1]!);
    const b = proj.toXY(line[i]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/** `a` hosszának hányad része fut `b`-től legfeljebb `tolM`-re (20 m-es mintavétellel). */
export function overlapShare(a: readonly LatLon[], b: readonly LatLon[], tolM = OVERLAP_TOLERANCE_M): number {
  let total = 0;
  let inside = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!;
    const q = a[i]!;
    const len = haversineM(p, q);
    const n = Math.max(1, Math.ceil(len / 20));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const pt = { lat: p.lat + (q.lat - p.lat) * t, lon: p.lon + (q.lon - p.lon) * t };
      total += len / n;
      if (distToPolylineM(pt, b) <= tolM) inside += len / n;
    }
  }
  return total > 0 ? inside / total : 0;
}

const line = (s: Section) => (s.geometry?.length ? s.geometry : [s.start, s.end]);

/**
 * Egy OSM-szakasz a hivatalos duplikátuma-e: ugyanaz az út (normalizált útszám), ugyanaz az irány
 * (a kezdő→vég irányszögek < 90°-ra), és a geometria legalább 70%-ban átfed (a rövidebbik hosszára
 * vetítve – bármelyik irányból számolva elég).
 */
export function isOsmDuplicate(osm: Section, official: Section): boolean {
  if (normalizeRef(osm.road, official.country) !== normalizeRef(official.road, official.country)) return false;
  if (angleDiffDeg(bearingDeg(osm.start, osm.end), bearingDeg(official.start, official.end)) >= 90) return false;
  const a = line(osm);
  const b = line(official);
  return Math.max(overlapShare(a, b), overlapShare(b, a)) >= DUPLICATE_MIN_OVERLAP;
}

/**
 * Hivatalos + OSM: a hivatalos elsőbbséget élvez; az OSM-szakasz nem ellenőrzöttként megmarad,
 * hacsak nem duplikátuma egy hivatalosnak (akkor csak a hivatalos marad). A megmaradó OSM-geometria
 * ugyanúgy egyszerűsödik (3 m), mint a hivatalos.
 */
export function mergeOfficialWithOsm(official: readonly Section[], osm: readonly Section[]): { sections: Section[]; duplicates: { osm: string; official: string }[] } {
  const duplicates: { osm: string; official: string }[] = [];
  const kept: Section[] = [];
  for (const o of osm) {
    const twin = official.find((f) => isOsmDuplicate(o, f));
    if (twin) duplicates.push({ osm: o.id, official: twin.id });
    else kept.push({ ...o, verified: false, limitSource: 'osm', ...(o.geometry ? { geometry: roundGeometry(simplifyGeometry(o.geometry)) } : {}) });
  }
  return { sections: [...official, ...kept].sort((a, b) => a.id.localeCompare(b.id)), duplicates };
}
