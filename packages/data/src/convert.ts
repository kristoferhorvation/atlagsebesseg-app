import { bearingDeg, haversineM, type LatLon, type Section } from '@atlagsebesseg/core';
import type { RoadGraph, Path } from './graph';
import type { OsmNode, OsmRelation, BBox } from './overpass';

export interface Skipped {
  relationId: number;
  reason: string;
}

export type BuildResult = { ok: true; section: Section } | { ok: false; skipped: Skipped };

interface Endpoints {
  start: OsmNode;
  end: OsmNode;
  /** `from`/`to` szerepből jött-e (ha csak `device`-ok vannak, az irány nem biztos). */
  ordered: boolean;
}

/** Kezdő- és végpont a reláció tagjaiból: `from`/`to`, ennek hiányában az első és utolsó `device`. */
export function extractEndpoints(rel: OsmRelation, nodes: ReadonlyMap<number, OsmNode>): Endpoints | string {
  const byRole = (role: string) =>
    rel.members.filter((m) => m.role === role && m.type === 'node').map((m) => nodes.get(m.ref)).filter((n): n is OsmNode => !!n);
  const from = byRole('from');
  const to = byRole('to');
  if (from.length && to.length) return { start: from[0]!, end: to[to.length - 1]!, ordered: true };
  if (rel.members.some((m) => (m.role === 'from' || m.role === 'to') && m.type !== 'node')) {
    return 'a from/to tag nem node (nem támogatott)';
  }
  const devices = byRole('device');
  if (devices.length >= 2) return { start: devices[0]!, end: devices[devices.length - 1]!, ordered: false };
  return 'nincs from/to, és kettőnél kevesebb device tag';
}

/** "130" → 130, "80 mph" → 128,7; egyéb (pl. "IT:motorway", "signals") → null. */
export function parseMaxspeed(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]?.toLowerCase() === 'mph' ? Math.round(n * 1.609344 * 10) / 10 : n;
}

export function bboxAround(points: readonly LatLon[], marginM: number): BBox {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const dLat = marginM / 111_195;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLon = marginM / (111_195 * Math.cos((midLat * Math.PI) / 180));
  return {
    south: Math.min(...lats) - dLat,
    north: Math.max(...lats) + dLat,
    west: Math.min(...lons) - dLon,
    east: Math.max(...lons) + dLon,
  };
}

const COMPASS = ['É', 'ÉK', 'K', 'DK', 'D', 'DNy', 'Ny', 'ÉNy'];
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;

export interface BuildOptions {
  /** Ennyi méteren belül keresünk úthálózati csomópontot a kezdő/végpont körül. */
  snapRadiusM?: number;
}

/**
 * Egy `enforcement=average_speed` relációból `Section`.
 * A geometriát az úthálózaton (egyirányúság szerint) keresett legrövidebb út adja,
 * így osztott pályás autópályán a helyes pályatestet kapjuk.
 */
export function buildSection(
  rel: OsmRelation,
  nodes: ReadonlyMap<number, OsmNode>,
  graph: RoadGraph,
  country: string,
  opts: BuildOptions = {},
): BuildResult {
  const skip = (reason: string): BuildResult => ({ ok: false, skipped: { relationId: rel.id, reason } });
  const ep = extractEndpoints(rel, nodes);
  if (typeof ep === 'string') return skip(ep);

  const snap = opts.snapRadiusM ?? 60;
  const straight = haversineM(ep.start, ep.end);
  const maxLen = straight * 1.6 + 2000;
  // Ha a tag-node maga is az út része, az pontosan kijelöli a pályatestet; különben a közeli csomópontok
  // közül a Dijkstra az irányhelyes (egyirányú) utat választja.
  const candidates = (n: OsmNode) => (graph.coords.has(n.id) ? [n.id] : graph.nearNodes(n, snap).slice(0, 12));
  const s = candidates(ep.start);
  const e = candidates(ep.end);
  if (!s.length || !e.length) return skip(`nincs autópálya/főút ${snap} m-en belül a kezdő- vagy végponthoz`);

  let path: Path | null;
  let start = ep.start;
  let end = ep.end;
  if (ep.ordered) {
    path = graph.shortestPath(s, e, maxLen);
  } else {
    const fwd = graph.shortestPath(s, e, maxLen);
    const back = graph.shortestPath(e, s, maxLen);
    if (fwd && back && Math.abs(fwd.lengthM - back.lengthM) < 0.2 * Math.min(fwd.lengthM, back.lengthM)) {
      return skip('csak device tagok, az irány nem egyértelmű (kétirányú út)');
    }
    path = fwd && (!back || fwd.lengthM <= back.lengthM) ? fwd : back;
    if (path === back) [start, end] = [ep.end, ep.start];
  }
  if (!path) return skip('nem található irányhelyes útvonal a kezdő- és végpont között');

  const geometry: LatLon[] = [...path.points];
  if (haversineM(geometry[0]!, start) > 1) geometry.unshift({ lat: start.lat, lon: start.lon });
  if (haversineM(geometry[geometry.length - 1]!, end) > 1) geometry.push({ lat: end.lat, lon: end.lon });
  let lengthM = 0;
  for (let i = 1; i < geometry.length; i++) lengthM += haversineM(geometry[i - 1]!, geometry[i]!);

  const tags = rel.tags ?? {};
  const wayTags = path.wayIds.map((id) => graph.ways.get(id)?.tags ?? {});
  const speedLimitKmh = parseMaxspeed(tags.maxspeed) ?? parseMaxspeed(mostCommon(wayTags.map((t) => t.maxspeed)));
  if (speedLimitKmh === null) return skip('nincs értelmezhető maxspeed (sem a reláción, sem az úton)');
  if (speedLimitKmh < 20 || speedLimitKmh > 200) return skip(`irreális maxspeed: ${speedLimitKmh}`);
  if (lengthM < 300 || lengthM > 100_000) return skip(`irreális hossz: ${Math.round(lengthM)} m`);

  const road = (tags.ref ?? mostCommon(wayTags.map((t) => t.ref)) ?? '').split(';')[0]!.trim();
  const named = tags.name ?? tags.description;
  const ends = [start.tags?.name, end.tags?.name].filter(Boolean);
  const destination = mostCommon(wayTags.map((t) => t.destination));
  const direction =
    named ?? (ends.length === 2 ? `${ends[0]} → ${ends[1]}` : destination ? `→ ${destination}` : `→ ${compass(bearingDeg(start, end))}`);

  return {
    ok: true,
    section: {
      id: `osm-${rel.id}`,
      country,
      road,
      direction,
      start: { lat: start.lat, lon: start.lon },
      end: { lat: end.lat, lon: end.lon },
      lengthM: Math.round(lengthM),
      speedLimitKmh,
      source: 'osm',
      verified: false,
      geometry: geometry.map((p) => ({ lat: round7(p.lat), lon: round7(p.lon) })),
    },
  };
}

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;

function mostCommon(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}
