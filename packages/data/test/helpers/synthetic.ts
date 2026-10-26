import { LocalProjection, type LatLon } from '@atlagsebesseg/core';
import { RoadGraph } from '../../src/graph';
import type { OsmNode, OsmWay } from '../../src/overpass';

/**
 * SZINTETIKUS Overpass-válasz (nem valódi OSM-adat): osztott pályás autópálya
 * (észak felé x = +15 m, dél felé x = −15 m), mellette 200 m-re kétirányú főút.
 */
export const P = new LocalProjection({ lat: 46.0, lon: 11.0 });
export const at = (x: number, y: number): LatLon => P.fromXY({ x, y });

export function way(id: number, firstNode: number, pts: LatLon[], tags: Record<string, string>): { way: OsmWay; nodes: OsmNode[] } {
  const ids = pts.map((_, i) => firstNode + i);
  return {
    way: { type: 'way', id, nodes: ids, geometry: pts, tags },
    nodes: pts.map((p, i) => ({ type: 'node', id: ids[i]!, ...p })),
  };
}
export const ys = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let y = from; step > 0 ? y <= to : y >= to; y += step) out.push(y);
  return out;
};

export const north = way(1, 1000, ys(-3000, 13000, 500).map((y) => at(15, y)), { highway: 'motorway', ref: 'A22;E45', maxspeed: '130' });
export const south = way(2, 2000, ys(13000, -3000, -500).map((y) => at(-15, y)), { highway: 'motorway', ref: 'A22;E45', maxspeed: '130' });
export const primary = way(3, 3000, ys(-3000, 13000, 500).map((y) => at(200, y)), { highway: 'primary', ref: 'SS12', maxspeed: '90' });
export const graph = new RoadGraph([north.way, south.way, primary.way]);

export const tagNodes = new Map<number, OsmNode>([
  [9001, { type: 'node', id: 9001, ...at(14, 0), tags: { name: 'Bolzano Sud' } }],
  [9002, { type: 'node', id: 9002, ...at(16, 10000), tags: { name: 'Bolzano Nord' } }],
  ...[...north.nodes, ...south.nodes, ...primary.nodes].map((n) => [n.id, n] as const),
]);
export const nodeAtY = (w: typeof north, y: number) => w.nodes.find((n) => Math.abs(P.toXY(n).y - y) < 1)!.id;

