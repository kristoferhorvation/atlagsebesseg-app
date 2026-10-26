import { haversineM, LocalProjection, type LatLon } from '@atlagsebesseg/core';
import type { OsmWay } from './overpass';

interface Edge {
  to: number;
  lengthM: number;
  wayId: number;
}

/** Irányított úthálózat OSM-utakból, a egyirányúság figyelembevételével. */
export class RoadGraph {
  readonly coords = new Map<number, LatLon>();
  readonly ways = new Map<number, OsmWay>();
  private readonly adj = new Map<number, Edge[]>();

  constructor(ways: readonly OsmWay[]) {
    for (const w of ways) {
      if (!w.geometry || w.geometry.length !== w.nodes.length) continue;
      this.ways.set(w.id, w);
      w.nodes.forEach((n, i) => this.coords.set(n, w.geometry![i]!));
      const dir = onewayDirection(w.tags ?? {});
      for (let i = 1; i < w.nodes.length; i++) {
        const a = w.nodes[i - 1]!;
        const b = w.nodes[i]!;
        const len = haversineM(w.geometry[i - 1]!, w.geometry[i]!);
        if (dir >= 0) this.addEdge(a, b, len, w.id);
        if (dir <= 0) this.addEdge(b, a, len, w.id);
      }
    }
  }

  private addEdge(from: number, to: number, lengthM: number, wayId: number) {
    let list = this.adj.get(from);
    if (!list) this.adj.set(from, (list = []));
    list.push({ to, lengthM, wayId });
  }

  /** A ponthoz `radiusM`-en belüli csomópontok, távolság szerint rendezve. */
  nearNodes(p: LatLon, radiusM: number): number[] {
    const out: [number, number][] = [];
    for (const [id, c] of this.coords) {
      const d = haversineM(p, c);
      if (d <= radiusM) out.push([id, d]);
    }
    return out.sort((a, b) => a[1] - b[1]).map(([id]) => id);
  }

  /**
   * A ponthoz `radiusM`-en belüli irányított élek (útszakaszok), a vetített ponttal.
   * Ritka csomópontú (hosszú, egyenes) utakon is talál illeszkedést, nem csak csomópontot.
   */
  nearEdges(p: LatLon, radiusM: number, limit = 12): EdgeHit[] {
    const hits: EdgeHit[] = [];
    for (const [from, edges] of this.adj) {
      const a = this.coords.get(from)!;
      if (haversineM(a, p) > radiusM + 5000) continue; // gyors előszűrés (élhossz ≤ ~5 km)
      for (const e of edges) {
        const b = this.coords.get(e.to)!;
        const proj = new LocalProjection(a);
        const bxy = proj.toXY(b);
        const pxy = proj.toXY(p);
        const len2 = bxy.x * bxy.x + bxy.y * bxy.y;
        const t = len2 > 0 ? Math.min(1, Math.max(0, (pxy.x * bxy.x + pxy.y * bxy.y) / len2)) : 0;
        const distM = Math.hypot(pxy.x - t * bxy.x, pxy.y - t * bxy.y);
        if (distM <= radiusM) {
          hits.push({ from, to: e.to, wayId: e.wayId, t, distM, lengthM: e.lengthM, point: proj.fromXY({ x: t * bxy.x, y: t * bxy.y }) });
        }
      }
    }
    return hits.sort((x, y) => x.distM - y.distM).slice(0, limit);
  }

  /**
   * Legrövidebb irányított út (Dijkstra) a források és a célok között. A forrásoknak kezdő-,
   * a céloknak záró költsége lehet (élre illesztett pontoknál a részleges élhossz).
   */
  shortestPath(
    sources: readonly (number | Anchor)[],
    targets: readonly (number | Anchor)[],
    maxLengthM = Infinity,
  ): Path | null {
    const anchor = (x: number | Anchor): Anchor => (typeof x === 'number' ? { node: x, cost: 0 } : x);
    const targetCost = new Map<number, number>();
    for (const t of targets.map(anchor)) targetCost.set(t.node, Math.min(targetCost.get(t.node) ?? Infinity, t.cost));
    const dist = new Map<number, number>();
    const prev = new Map<number, { node: number; wayId: number }>();
    const heap = new MinHeap();
    for (const s of sources.map(anchor)) {
      if (s.cost < (dist.get(s.node) ?? Infinity)) {
        dist.set(s.node, s.cost);
        heap.push(s.node, s.cost);
      }
    }
    let best: { node: number; total: number } | null = null;
    while (heap.size) {
      const [u, d] = heap.pop()!;
      if (d > (dist.get(u) ?? Infinity)) continue;
      if (d > maxLengthM || (best && d >= best.total)) break;
      const tc = targetCost.get(u);
      if (tc !== undefined && d + tc < (best?.total ?? Infinity)) best = { node: u, total: d + tc };
      for (const e of this.adj.get(u) ?? []) {
        const nd = d + e.lengthM;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { node: u, wayId: e.wayId });
          heap.push(e.to, nd);
        }
      }
    }
    if (!best || best.total > maxLengthM) return null;
    const nodes = [best.node];
    const wayIds: number[] = [];
    let cur = best.node;
    while (prev.has(cur)) {
      const p = prev.get(cur)!;
      wayIds.push(p.wayId);
      cur = p.node;
      nodes.push(cur);
    }
    nodes.reverse();
    wayIds.reverse();
    return { nodes, wayIds, lengthM: best.total, points: nodes.map((n) => this.coords.get(n)!) };
  }
}

/** Dijkstra-forrás/-cél kezdő/záró költséggel (m). */
export interface Anchor {
  node: number;
  cost: number;
}

export interface EdgeHit {
  from: number;
  to: number;
  wayId: number;
  /** A vetített pont helye az élen, 0 (from) … 1 (to). */
  t: number;
  distM: number;
  lengthM: number;
  point: LatLon;
}

export interface Path {
  nodes: number[];
  /** Élenként az út azonosítója (nodes.length − 1 elem). */
  wayIds: number[];
  lengthM: number;
  points: LatLon[];
}

/** 1 = csak előre, −1 = csak visszafelé, 0 = mindkét irány. */
export function onewayDirection(tags: Record<string, string>): -1 | 0 | 1 {
  const ow = tags.oneway;
  if (ow === '-1' || ow === 'reverse') return -1;
  if (ow === 'yes' || ow === '1' || ow === 'true') return 1;
  if (ow === 'no' || ow === '0' || ow === 'false') return 0;
  if (tags.junction === 'roundabout') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

class MinHeap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(id: number, key: number) {
    const a = this.items;
    a.push([id, key]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![1] <= a[i]![1]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![1] < a[m]![1]) m = l;
        if (r < a.length && a[r]![1] < a[m]![1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
