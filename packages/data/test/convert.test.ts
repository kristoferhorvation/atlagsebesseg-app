import { describe, expect, it, vi } from 'vitest';
import { LocalProjection, Route, SectionTracker, haversineM, type LatLon } from '@atlagsebesseg/core';
import { buildSection, compass, extractEndpoints, parseMaxspeed } from '../src/convert';
import { onewayDirection, RoadGraph } from '../src/graph';
import { relationsQuery, roadsQuery, runOverpass, type OsmNode, type OsmRelation, type OsmWay } from '../src/overpass';

/**
 * SZINTETIKUS Overpass-válasz (nem valódi OSM-adat): osztott pályás autópálya
 * (észak felé x = +15 m, dél felé x = −15 m), mellette 200 m-re kétirányú főút.
 */
const P = new LocalProjection({ lat: 46.0, lon: 11.0 });
const at = (x: number, y: number): LatLon => P.fromXY({ x, y });

function way(id: number, firstNode: number, pts: LatLon[], tags: Record<string, string>): { way: OsmWay; nodes: OsmNode[] } {
  const ids = pts.map((_, i) => firstNode + i);
  return {
    way: { type: 'way', id, nodes: ids, geometry: pts, tags },
    nodes: pts.map((p, i) => ({ type: 'node', id: ids[i]!, ...p })),
  };
}
const ys = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let y = from; step > 0 ? y <= to : y >= to; y += step) out.push(y);
  return out;
};

const north = way(1, 1000, ys(-3000, 13000, 500).map((y) => at(15, y)), { highway: 'motorway', ref: 'A22;E45', maxspeed: '130' });
const south = way(2, 2000, ys(13000, -3000, -500).map((y) => at(-15, y)), { highway: 'motorway', ref: 'A22;E45', maxspeed: '130' });
const primary = way(3, 3000, ys(-3000, 13000, 500).map((y) => at(200, y)), { highway: 'primary', ref: 'SS12', maxspeed: '90' });
const graph = new RoadGraph([north.way, south.way, primary.way]);

const tagNodes = new Map<number, OsmNode>([
  [9001, { type: 'node', id: 9001, ...at(14, 0), tags: { name: 'Bolzano Sud' } }],
  [9002, { type: 'node', id: 9002, ...at(16, 10000), tags: { name: 'Bolzano Nord' } }],
  ...[...north.nodes, ...south.nodes, ...primary.nodes].map((n) => [n.id, n] as const),
]);
const nodeAtY = (w: typeof north, y: number) => w.nodes.find((n) => Math.abs(P.toXY(n).y - y) < 1)!.id;

const rel = (id: number, members: OsmRelation['members'], tags: Record<string, string> = {}): OsmRelation => ({
  type: 'relation',
  id,
  members,
  tags: { type: 'enforcement', enforcement: 'average_speed', ...tags },
});

describe('buildSection', () => {
  it('from/to: a helyes (észak felé tartó) pályatestet választja', () => {
    const r = buildSection(
      rel(1, [
        { type: 'node', ref: 9001, role: 'from' },
        { type: 'node', ref: 9002, role: 'to' },
      ], { maxspeed: '130' }),
      tagNodes,
      graph,
      'IT',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.section;
    expect(s).toMatchObject({ id: 'osm-1', country: 'IT', road: 'A22', speedLimitKmh: 130, source: 'osm', verified: false });
    expect(s.direction).toBe('Bolzano Sud → Bolzano Nord');
    expect(Math.abs(s.lengthM - 10_000)).toBeLessThan(5);
    for (const p of s.geometry!) expect(Math.abs(P.toXY(p).x - 15)).toBeLessThan(2);
    // a kapott geometrián a tracker működik
    const route = new Route(s.geometry!, s.lengthM);
    expect(route.project(at(15, 5000)).alongM).toBeCloseTo(5000, -1);
    expect(() => new SectionTracker([s])).not.toThrow();
  });

  it('csak device-ok, fordított sorrendben, egyirányú pályán: az irányt az úthálózat dönti el', () => {
    const r = buildSection(
      rel(2, [
        { type: 'node', ref: nodeAtY(south, 0), role: 'device' },
        { type: 'node', ref: nodeAtY(south, 10000), role: 'device' },
      ], { maxspeed: '130' }),
      tagNodes,
      graph,
      'IT',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.section.start.lat).toBeGreaterThan(r.section.end.lat);
    expect(r.section.direction).toBe('→ D');
  });

  it('csak device-ok kétirányú úton: kihagyja (nem egyértelmű)', () => {
    const r = buildSection(
      rel(3, [
        { type: 'node', ref: nodeAtY(primary, 0), role: 'device' },
        { type: 'node', ref: nodeAtY(primary, 8000), role: 'device' },
      ], { maxspeed: '90' }),
      tagNodes,
      graph,
      'AT',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.skipped.reason).toMatch(/nem egyértelmű/);
  });

  it('maxspeed hiányában az út maxspeed-jét használja', () => {
    const r = buildSection(
      rel(4, [
        { type: 'node', ref: 9001, role: 'from' },
        { type: 'node', ref: 9002, role: 'to' },
      ]),
      tagNodes,
      graph,
      'IT',
    );
    expect(r.ok && r.section.speedLimitKmh).toBe(130);
  });

  it('hiányzó tagok / távoli pont: kihagyja indoklással', () => {
    const missing = buildSection(rel(5, [{ type: 'node', ref: 424242, role: 'from' }]), tagNodes, graph, 'IT');
    expect(missing.ok).toBe(false);
    const far = new Map(tagNodes);
    far.set(9003, { type: 'node', id: 9003, ...at(5000, 0) });
    const r = buildSection(rel(6, [
      { type: 'node', ref: 9003, role: 'from' },
      { type: 'node', ref: 9002, role: 'to' },
    ]), far, graph, 'IT');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.skipped.reason).toMatch(/nincs autópálya/);
  });

  it('from/to way-ként: nem támogatott', () => {
    const r = extractEndpoints(rel(7, [{ type: 'way', ref: 1, role: 'from' }, { type: 'way', ref: 2, role: 'to' }]), tagNodes);
    expect(r).toMatch(/nem node/);
  });
});

describe('segédfüggvények', () => {
  it('parseMaxspeed', () => {
    expect(parseMaxspeed('130')).toBe(130);
    expect(parseMaxspeed('110 km/h')).toBe(110);
    expect(parseMaxspeed('50 mph')).toBeCloseTo(80.5, 1);
    expect(parseMaxspeed('IT:motorway')).toBeNull();
    expect(parseMaxspeed(undefined)).toBeNull();
  });

  it('onewayDirection', () => {
    expect(onewayDirection({ highway: 'motorway' })).toBe(1);
    expect(onewayDirection({ highway: 'motorway', oneway: 'no' })).toBe(0);
    expect(onewayDirection({ highway: 'primary' })).toBe(0);
    expect(onewayDirection({ highway: 'primary', oneway: '-1' })).toBe(-1);
    expect(onewayDirection({ highway: 'primary', junction: 'roundabout' })).toBe(1);
  });

  it('compass', () => {
    expect(compass(0)).toBe('É');
    expect(compass(92)).toBe('K');
    expect(compass(225)).toBe('DNy');
    expect(compass(359)).toBe('É');
  });

  it('a gráf legrövidebb útja tiszteletben tartja az egyirányúságot', () => {
    const fwd = graph.shortestPath([nodeAtY(north, 0)], [nodeAtY(north, 5000)]);
    const back = graph.shortestPath([nodeAtY(north, 5000)], [nodeAtY(north, 0)]);
    expect(fwd!.lengthM).toBeCloseTo(5000, -1);
    expect(back).toBeNull();
    expect(haversineM(fwd!.points[0]!, at(15, 0))).toBeLessThan(1);
  });
});

describe('Overpass', () => {
  it('lekérdezések', () => {
    const q = relationsQuery('IT');
    expect(q).toContain('"ISO3166-1"="IT"');
    expect(q).toContain('["enforcement"="average_speed"]');
    expect(q).toContain('node(r.r)');
    expect(roadsQuery({ south: 1, west: 2, north: 3, east: 4 })).toContain('(1.000000,2.000000,3.000000,4.000000)');
  });

  it('429 után újrapróbál', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    const res = await runOverpass('x', { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 1 });
    expect(res.elements).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('400-ra nem próbál újra', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad query', { status: 400 }));
    await expect(runOverpass('x', { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 1 })).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
