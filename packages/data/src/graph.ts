import { haversineM, type LatLon } from '@atlagsebesseg/core';
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

  /** Legrövidebb irányított út (Dijkstra) a források és a célok bármely párja között. */
  shortestPath(sources: readonly number[], targets: readonly number[], maxLengthM = Infinity): Path | null {
    const targetSet = new Set(targets);
    const dist = new Map<number, number>();
    const prev = new Map<number, { node: number; wayId: number }>();
    const heap = new MinHeap();
    for (const s of sources) {
      dist.set(s, 0);
      heap.push(s, 0);
    }
    while (heap.size) {
      const [u, d] = heap.pop()!;
      if (d > (dist.get(u) ?? Infinity)) continue;
      if (d > maxLengthM) return null;
      if (targetSet.has(u)) {
        const nodes = [u];
        const wayIds: number[] = [];
        let cur = u;
        while (prev.has(cur)) {
          const p = prev.get(cur)!;
          wayIds.push(p.wayId);
          cur = p.node;
          nodes.push(cur);
        }
        nodes.reverse();
        wayIds.reverse();
        return { nodes, wayIds, lengthM: d, points: nodes.map((n) => this.coords.get(n)!) };
      }
      for (const e of this.adj.get(u) ?? []) {
        const nd = d + e.lengthM;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { node: u, wayId: e.wayId });
          heap.push(e.to, nd);
        }
      }
    }
    return null;
  }
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
