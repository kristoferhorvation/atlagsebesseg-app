import { haversineM, LocalProjection, type LatLon } from '@atlagsebesseg/core';
import type { Anchor, Path, RoadGraph } from './graph';

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
  const maxLen = haversineM(start, end) * (opts.maxDetourFactor ?? 1.6) + 2000;
  const exact = (g: Gate) => g.nodeId !== undefined && graph.coords.has(g.nodeId);

  // Ha a kapu ismert csomópont, pontosan az; különben a közeli élekre vetítjük (ritka csomópontú
  // egyenes szakaszon is működik), a részleges élhosszal mint kezdő/záró költséggel.
  const startHits = exact(start) ? [] : graph.nearEdges(start, snap);
  const endHits = exact(end) ? [] : graph.nearEdges(end, snap);
  if ((!exact(start) && !startHits.length) || (!exact(end) && !endHits.length)) {
    return `nincs autópálya/főút ${snap} m-en belül a kezdő- vagy végponthoz`;
  }
  const sources: Anchor[] = exact(start) ? [{ node: start.nodeId!, cost: 0 }] : startHits.map((h) => ({ node: h.to, cost: (1 - h.t) * h.lengthM }));
  const targets: Anchor[] = exact(end) ? [{ node: end.nodeId!, cost: 0 }] : endHits.map((h) => ({ node: h.from, cost: h.t * h.lengthM }));

  let best: RouteBetween | null = null;
  const path = graph.shortestPath(sources, targets, maxLen);
  if (path) {
    // melyik élre illesztett pontból indult / melyikben ért véget
    const sHit = startHits.find((h) => h.to === path.nodes[0]);
    const eHit = endHits.find((h) => h.from === path.nodes[path.nodes.length - 1]);
    const wayIds = [...(sHit ? [sHit.wayId] : []), ...path.wayIds, ...(eHit ? [eHit.wayId] : [])];
    // élre illesztésnél a vonal az úton lévő vetített pontból indul (nem a GPS-pontból)
    best = finish(graph, { ...path, wayIds }, sHit?.point ?? start, eHit?.point ?? end);
  }
  // mindkét kapu ugyanazon az élen, helyes sorrendben
  for (const s of startHits) {
    for (const e of endHits) {
      if (s.from === e.from && s.to === e.to && s.wayId === e.wayId && s.t <= e.t) {
        const direct = finish(graph, { nodes: [], wayIds: [s.wayId], lengthM: (e.t - s.t) * s.lengthM, points: [] }, s.point, e.point);
        if (!best || direct.lengthM < best.lengthM) best = direct;
      }
    }
  }
  return best ?? 'nem található irányhelyes útvonal a kezdő- és végpont között';
}

export function finish(graph: RoadGraph, path: Path, start: LatLon, end: LatLon): RouteBetween {
  const geometry: LatLon[] = [];
  for (const p of [start, ...path.points, end]) {
    const prev = geometry[geometry.length - 1];
    if (!prev || haversineM(prev, p) > 1) geometry.push({ lat: p.lat, lon: p.lon });
  }
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

/**
 * Douglas–Peucker egyszerűsítés: a vonaltól `toleranceM`-nél közelebbi közbülső pontok elhagyhatók
 * (a beépített szakaszlista méretéhez); a két vég mindig marad.
 */
export function simplifyGeometry(g: readonly LatLon[], toleranceM = 3): LatLon[] {
  if (g.length <= 2) return [...g];
  const proj = new LocalProjection(g[0]!);
  const xy = g.map((p) => proj.toXY(p));
  const keep = new Uint8Array(g.length);
  keep[0] = keep[g.length - 1] = 1;
  const stack: [number, number][] = [[0, g.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = xy[a]!;
    const B = xy[b]!;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const P = xy[i]!;
      const d = len > 0 ? Math.abs(dy * (P.x - A.x) - dx * (P.y - A.y)) / len : Math.hypot(P.x - A.x, P.y - A.y);
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > toleranceM) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return g.filter((_, i) => keep[i]);
}
