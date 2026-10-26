import { haversineM, type LatLon } from '@atlagsebesseg/core';
import type { Path, RoadGraph } from './graph';

export interface Gate extends LatLon {
  /** OSM node-azonosító, ha a kapu egy ismert node (akkor pontosan azt a csomópontot használjuk). */
  nodeId?: number;
}

export interface RouteBetweenOptions {
  /** Ennyi méteren belül keresünk úthálózati csomópontot a kapuk körül. */
  snapRadiusM?: number;
  /** Az útvonal legfeljebb ennyiszerese lehet a légvonalnak (+2 km). */
  maxDetourFactor?: number;
}

export interface RouteBetween {
  path: Path;
  /** A kapuktól a kapukig tartó vonal. */
  geometry: LatLon[];
  lengthM: number;
  /** Az útvonalon érintett OSM-utak címkéi (élenként). */
  wayTags: Record<string, string>[];
}

/**
 * A kezdőkaputól a zárókapuig tartó, irányhelyes útvonal az úthálózaton (Dijkstra, egyirányúság
 * szerint). Osztott pályás úton ez választja ki a helyes pályatestet.
 * Közös az OSM-relációk, a kézi (hu-manual) szakaszok és az ideiglenes kapuk számára.
 */
export function routeBetween(graph: RoadGraph, start: Gate, end: Gate, opts: RouteBetweenOptions = {}): RouteBetween | string {
  const snap = opts.snapRadiusM ?? 60;
  const candidates = (g: Gate) =>
    g.nodeId !== undefined && graph.coords.has(g.nodeId) ? [g.nodeId] : graph.nearNodes(g, snap).slice(0, 12);
  const s = candidates(start);
  const e = candidates(end);
  if (!s.length || !e.length) return `nincs autópálya/főút ${snap} m-en belül a kezdő- vagy végponthoz`;
  const maxLen = haversineM(start, end) * (opts.maxDetourFactor ?? 1.6) + 2000;
  const path = graph.shortestPath(s, e, maxLen);
  if (!path) return 'nem található irányhelyes útvonal a kezdő- és végpont között';
  return finish(graph, path, start, end);
}

export function finish(graph: RoadGraph, path: Path, start: LatLon, end: LatLon): RouteBetween {
  const geometry: LatLon[] = [...path.points];
  if (haversineM(geometry[0]!, start) > 1) geometry.unshift({ lat: start.lat, lon: start.lon });
  if (haversineM(geometry[geometry.length - 1]!, end) > 1) geometry.push({ lat: end.lat, lon: end.lon });
  let lengthM = 0;
  for (let i = 1; i < geometry.length; i++) lengthM += haversineM(geometry[i - 1]!, geometry[i]!);
  return { path, geometry, lengthM, wayTags: path.wayIds.map((id) => graph.ways.get(id)?.tags ?? {}) };
}

export function mostCommon(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

export const round7 = (x: number) => Math.round(x * 1e7) / 1e7;
export const roundGeometry = (g: LatLon[]) => g.map((p) => ({ lat: round7(p.lat), lon: round7(p.lon) }));

/** Útszám a címkékből: "A22;E45" → "A22". */
export const roadRef = (ref: string | undefined) => (ref ?? '').split(';')[0]!.trim();
