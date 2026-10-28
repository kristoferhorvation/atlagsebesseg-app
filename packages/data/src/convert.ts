import { bearingDeg, type LatLon, type Section } from '@atlagsebesseg/core';
import type { RoadGraph } from './graph';
import { mostCommon, roadRef, roundGeometry, routeBetween, type Gate, type RouteBetween } from './routeBetween';
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
/** Mérőeszköz-azonosító (nem útszám): pontot vagy legalább 5 egymás utáni számjegyet tartalmaz. */
export function isDeviceCode(ref: string): boolean {
  return /\./.test(ref) || /\d{5,}/.test(ref);
}

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

  const snap = { snapRadiusM: opts.snapRadiusM };
  const gate = (n: OsmNode): Gate => ({ lat: n.lat, lon: n.lon, nodeId: n.id });
  let start = ep.start;
  let end = ep.end;
  let route: RouteBetween | string;
  if (ep.ordered) {
    route = routeBetween(graph, gate(start), gate(end), snap);
  } else {
    const fwd = routeBetween(graph, gate(start), gate(end), snap);
    const back = routeBetween(graph, gate(end), gate(start), snap);
    if (typeof fwd !== 'string' && typeof back !== 'string') {
      if (Math.abs(fwd.lengthM - back.lengthM) < 0.2 * Math.min(fwd.lengthM, back.lengthM)) {
        return skip('csak device tagok, az irány nem egyértelmű (kétirányú út)');
      }
    }
    const useBack = typeof back !== 'string' && (typeof fwd === 'string' || back.lengthM < fwd.lengthM);
    route = useBack ? back : fwd;
    if (useBack) [start, end] = [ep.end, ep.start];
  }
  if (typeof route === 'string') return skip(route);
  const { geometry, lengthM, wayTags } = route;

  const tags = rel.tags ?? {};
  const speedLimitKmh = parseMaxspeed(tags.maxspeed) ?? parseMaxspeed(mostCommon(wayTags.map((t) => t.maxspeed)));
  if (speedLimitKmh === null) return skip('nincs értelmezhető maxspeed (sem a reláción, sem az úton)');
  if (speedLimitKmh < 20 || speedLimitKmh > 200) return skip(`irreális maxspeed: ${speedLimitKmh}`);
  if (lengthM < 300 || lengthM > 100_000) return skip(`irreális hossz: ${Math.round(lengthM)} m`);

  // a reláció ref-je több országban az eszköz kódja (PL „CAN.O.2.006”, NL „a0020001”) – akkor az útszám
  // az útvonal útjaiból jön
  const relRef = tags.ref && !isDeviceCode(tags.ref) ? tags.ref : undefined;
  const road = roadRef(relRef ?? mostCommon(wayTags.map((t) => t.ref)));
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
      geometry: roundGeometry(geometry),
    },
  };
}
