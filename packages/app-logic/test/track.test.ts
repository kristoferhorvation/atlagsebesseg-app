import { describe, expect, it } from 'vitest';
import { bearingDeg, haversineM, type LatLon } from '@atlagsebesseg/core';
import { assembleLines, globalLines, HEAT, mapboxMatcher, mapboxMatchUrl, matchChunks, matchRadius, matchTrace, MATCHER_MAPBOX, parseMapboxMatch, parseSegmentOutbox, rawLines, recordTrace, segmentKey, segmentUploadRows, seedGlobalRows, simplifyForMatch, traceChunks, TRACK, TrackIndex, trackSegments, type MapMatcher, type MatchResult, type TrackLine, type TrackPoint, type TripSample } from '../src';
import fixture from '../src/fixtures/track-budapest.json';
import roadsFile from '../src/fixtures/track-budapest-roads.json';

const samples: TripSample[] = fixture.samples.map(([t, lat, lon, kmh]) => ({ tripId: 'budapest', t: t!, lat: lat!, lon: lon!, speedKmh: kmh!, heading: null, accuracy: 8, h3: null, limitKmh: null }));
const parts = recordTrace(samples);

/** A felvett illesztő: a rögzített valódi válaszokat adja vissza, sorrendben. */
const replayMatcher = (): MapMatcher => {
  const all = fixture.matches.flat();
  let i = 0;
  return { id: MATCHER_MAPBOX, match: async (p) => parseMapboxMatch(all[i++], p.length) };
};
const lines = await matchTrace(parts, replayMatcher());
const matched = lines.filter((l) => l.matched);
const raw = lines.filter((l) => !l.matched);

/** A pont távolsága a szakasztól (m, helyi síkban). */
function segDist(p: LatLon, a: number[], b: number[]): number {
  const k = Math.cos((p.lat * Math.PI) / 180) * 111_195;
  const ax = (a[1]! - p.lon) * k;
  const ay = (a[0]! - p.lat) * 111_195;
  const dx = (b[1]! - a[1]!) * k;
  const dy = (b[0]! - a[0]!) * 111_195;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}
const roads = roadsFile.roads as number[][][];
const roadDist = (p: LatLon) => {
  let best = Infinity;
  for (const r of roads) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, segDist(p, r[i]!, r[i + 1]!));
  return best;
};
const lengthM = (c: readonly number[][]) => c.slice(1).reduce((s, x, i) => s + haversineM({ lat: c[i]![0]!, lon: c[i]![1]! }, { lat: x[0]!, lon: x[1]! }), 0);
const pt = (t: number, lat: number, lon: number, kmh = 40, acc: number | null = 8): TrackPoint => ({ t, lat, lon, kmh, acc });
const sample = (t: number, lat: number, lon: number, accuracy: number | null = 8): TripSample => ({ tripId: 'x', t, lat, lon, speedKmh: 40, heading: null, accuracy, h3: null, limitKmh: null });
const line = (coords: [number, number][], matched = true, kmh = 50): TrackLine => ({ matched, coords, kmh: coords.map(() => kmh) });
/** Észak felé egyenes, `n` darab `stepM` méteres lépéssel. */
const north = (n: number, stepM: number, lat0 = 47.5, lon0 = 19): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [lat0 + (i * stepM) / 111_195, lon0]);

describe('AW24: valódi budapesti nyomat', () => {
  it('az illesztett vonal az utcán halad: minden csúcs az OSM-úthálózaton van, a nyers pontok átlagosan távolabb', () => {
    const vertices = matched.flatMap((l) => l.coords);
    expect(vertices.length).toBeGreaterThan(30);
    for (const [lat, lon] of vertices) expect(roadDist({ lat, lon })).toBeLessThan(6);
    const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
    const rawD = avg(parts.flat().map((p) => roadDist(p)));
    expect(avg(vertices.map(([lat, lon]) => roadDist({ lat, lon })))).toBeLessThan(rawD);
  });

  it('a kanyart követi: a vonal irányt vált, és nem vágja le a sarkot (több csúcs, mint az egyszerűsített pontok közti egyenes)', () => {
    const c = matched[0]!.coords;
    let turns = 0;
    let prev: number | null = null;
    for (let i = 1; i < c.length; i++) {
      const d = haversineM({ lat: c[i - 1]![0], lon: c[i - 1]![1] }, { lat: c[i]![0], lon: c[i]![1] });
      if (d < 10) continue;
      const b = bearingDeg({ lat: c[i - 1]![0], lon: c[i - 1]![1] }, { lat: c[i]![0], lon: c[i]![1] });
      if (prev !== null && Math.abs(((b - prev + 540) % 360) - 180) > 45) turns++;
      prev = b;
    }
    expect(turns).toBeGreaterThanOrEqual(2);
    expect(c.length).toBeGreaterThan(simplifyForMatch(parts[0]!).length);
  });

  it('a tilos megfordulás egyenes: a két irány külön illeszkedik, a visszaforduló pontnál nincs körbevezető vonal', () => {
    const chunks = traceChunks(simplifyForMatch(parts[1]!));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // a szétválasztás miatt az illesztés mindkét oldalon biztos
    for (const m of fixture.matches[1]!) for (const x of m.matchings!) expect(x.confidence).toBeGreaterThan(TRACK.minConfidence);
    // az egész nyomat hossza körül marad: kerülő (a háztömb megkerülése) nincs benne
    const rawLen = parts.reduce((s, p) => s + lengthM(p.map((x) => [x.lat, x.lon])), 0);
    expect(lines.reduce((s, l) => s + lengthM(l.coords), 0)).toBeLessThan(rawLen * 1.1);
    const uturn = fixture.samples.find((s) => s[0] === fixture.uturnT)!;
    const near = (l: TrackLine) => l.coords.some(([lat, lon]) => haversineM({ lat, lon }, { lat: uturn[1]!, lon: uturn[2]! }) < 40);
    expect(lines.some(near)).toBe(true);
  });

  it('a GPS-kiesésnél megszakad: két darab, köztük nincs vonal', () => {
    expect(parts.length).toBe(2);
    const a = parts[0]!.at(-1)!;
    const b = parts[1]![0]!;
    expect(a.t).toBe(fixture.gap!.beforeT);
    expect(b.t).toBe(fixture.gap!.afterT);
    expect(haversineM(a, b)).toBeGreaterThan(TRACK.gapM);
    const crossing = lines.some((l) => l.coords.some(([lat, lon]) => haversineM({ lat, lon }, a) < 1) && l.coords.some(([lat, lon]) => haversineM({ lat, lon }, b) < 1));
    expect(crossing).toBe(false);
  });
});

describe('AW24: pontsor a mintákból', () => {
  it('kb. 20 méterenként egy pont, a ±30 m-nél rosszabb minta kimarad', () => {
    const s = north(100, 5).map(([lat, lon], i) => sample(i * 1000, lat, lon, i === 50 ? 31 : 8));
    const [p] = recordTrace(s);
    expect(p!.length).toBeGreaterThan(20);
    expect(p!.length).toBeLessThan(30);
    expect(p!.some((x) => x.t === 50_000)).toBe(false);
  });

  it('irányváltásnál akkor is pont kerül be, ha még nem telt le a 20 méter', () => {
    const k = 111_195;
    const a = north(4, 10).map(([lat, lon], i) => sample(i * 1000, lat, lon));
    const end = a.at(-1)!;
    const b = [1, 2].map((i) => sample(4000 + i * 1000, end.lat, end.lon + (i * 10) / (k * Math.cos((end.lat * Math.PI) / 180))));
    const [p] = recordTrace([...a, ...b]);
    expect(p!.some((x) => x.t === 5000)).toBe(true);
  });

  it('a 200 m-nél nagyobb ugrás új darabot kezd, a kisebb nem', () => {
    const near = [sample(0, 47.5, 19), sample(1000, 47.5002, 19), sample(2000, 47.5004, 19)];
    expect(recordTrace(near).length).toBe(1);
    const far = [...near, sample(3000, 47.51, 19), sample(4000, 47.5103, 19)];
    expect(recordTrace(far).length).toBe(2);
  });

  it('az egyszerűsítés egyenesen kevesebb pontot hagy, a kanyart megtartja, nagy hézagot nem', () => {
    const straight = north(100, 20).map(([lat, lon], i) => pt(i * 1000, lat, lon));
    const s = simplifyForMatch(straight);
    expect(s.length).toBeLessThan(10);
    for (let i = 1; i < s.length; i++) expect(haversineM(s[i - 1]!, s[i]!)).toBeLessThanOrEqual(TRACK.maxSpacingM + 20);
    const corner = [...north(5, 40).map(([lat, lon], i) => pt(i * 1000, lat, lon)), pt(6000, 47.5018, 19.001)];
    expect(simplifyForMatch(corner).length).toBeGreaterThanOrEqual(3);
  });

  it('megfordulásnál új kérés indul, a közös ponttal', () => {
    const fwd = north(5, 40).map(([lat, lon], i) => pt(i * 1000, lat, lon));
    const back = north(4, 40).reverse().map(([lat, lon], i) => pt(6000 + i * 1000, lat, lon));
    const c = traceChunks([...fwd, ...back]);
    expect(c.length).toBe(2);
    expect(c[0]!.at(-1)).toBe(fwd.at(-1));
    expect(c[1]![0]).toBe(fwd.at(-1));
    expect(traceChunks(fwd).length).toBe(1);
  });

  it('a darabolás a pontkorlát szerint, egy közös ponttal', () => {
    const p = north(249, 20).map(([lat, lon], i) => pt(i * 1000, lat, lon));
    const c = matchChunks(p);
    expect(c.every((x) => x.length <= 100)).toBe(true);
    expect(c.length).toBe(3);
    expect(c[0]!.at(-1)).toBe(c[1]![0]);
    expect(c.flat().length).toBe(250 + 2);
    expect(matchChunks(p.slice(0, 1))).toEqual([]);
  });
});

describe('AW24: illesztő-réteg', () => {
  it('a kérés: driving, teljes geometria, sugár a pontosságból, növekvő időbélyeg', () => {
    const u = new URL(mapboxMatchUrl([pt(1000, 47.5, 19, 40, 8), pt(1000, 47.501, 19, 40, null), pt(2000, 47.502, 19, 40, 80)], 'pk.x'));
    expect(u.pathname).toContain('/matching/v5/mapbox/driving/19.000000,47.500000;');
    expect(u.searchParams.get('geometries')).toBe('geojson');
    expect(u.searchParams.get('overview')).toBe('full');
    expect(u.searchParams.get('radiuses')).toBe('12;30;50');
    const ts = u.searchParams.get('timestamps')!.split(';').map(Number);
    expect(ts[1]!).toBeGreaterThan(ts[0]!);
    expect(ts[2]!).toBeGreaterThan(ts[1]!);
    expect(matchRadius(1)).toBe(TRACK.radiusMinM);
  });

  it('a 422 és a NoMatch egyenes vonalat ad, a szerverhiba kivétel (később újrapróba)', async () => {
    const p = north(3, 50).map(([lat, lon], i) => pt(i * 1000, lat, lon));
    const res = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const l = await matchTrace([p], mapboxMatcher('pk.x', res(422, { code: 'InvalidInput' })));
    expect(l.length).toBe(1);
    expect(l[0]!.matched).toBe(false);
    const n = await matchTrace([p], mapboxMatcher('pk.x', res(200, { code: 'NoMatch' })));
    expect(n[0]!.matched).toBe(false);
    await expect(matchTrace([p], mapboxMatcher('pk.x', res(503, {})))).rejects.toThrow('http_503');
  });

  it('másik illesztő ugyanazon a felületen cserélhető', async () => {
    const p = north(2, 50).map(([lat, lon], i) => pt(i * 1000, lat, lon));
    const other: MapMatcher = {
      id: 'osrm',
      match: async (c): Promise<MatchResult> => ({ matchings: [{ confidence: 1, coords: c.map((x) => [x.lat, x.lon]), legsM: c.slice(1).map((x, i) => haversineM(c[i]!, x)) }], tracepoints: c.map((x) => ({ matching: 0, lat: x.lat, lon: x.lon })) }),
    };
    const l = await matchTrace([p], other);
    expect(l.length).toBe(1);
    expect(l[0]!.matched).toBe(true);
  });

  it('illesztő nélkül a nyers pontok egyenesei, a darabok külön', () => {
    const l = rawLines([north(2, 50).map(([lat, lon], i) => pt(i, lat, lon)), north(2, 50, 47.6).map(([lat, lon], i) => pt(i, lat, lon))]);
    expect(l.length).toBe(2);
    expect(l.every((x) => !x.matched)).toBe(true);
  });

  it('kerülő-őr: a két pont közti háztömb-megkerülés helyett egyenes', () => {
    const a = pt(0, 47.5, 19);
    const b = pt(1000, 47.5003, 19);
    const loop: [number, number][] = [[47.5, 19], [47.502, 19], [47.502, 19.002], [47.5003, 19.002], [47.5003, 19]];
    const r: MatchResult = { matchings: [{ confidence: 0.9, coords: loop, legsM: [lengthM(loop)] }], tracepoints: [{ matching: 0, lat: 47.5, lon: 19 }, { matching: 0, lat: 47.5003, lon: 19 }] };
    const l = assembleLines([[a, b]], [r]);
    expect(l.length).toBe(1);
    expect(l[0]!.matched).toBe(false);
    expect(l[0]!.coords.length).toBe(2);
  });

  it('gyenge bizalmú illesztés nem számít', () => {
    const a = pt(0, 47.5, 19);
    const b = pt(1000, 47.5003, 19);
    const r: MatchResult = { matchings: [{ confidence: 0.05, coords: [[47.5, 19], [47.5003, 19]], legsM: [33] }], tracepoints: [{ matching: 0, lat: 47.5, lon: 19 }, { matching: 0, lat: 47.5003, lon: 19 }] };
    expect(assembleLines([[a, b]], [r])[0]!.matched).toBe(false);
  });

  it('illesztett és egyenes darab váltásánál nincs rés', () => {
    const p = [pt(0, 47.5, 19), pt(1000, 47.5003, 19), pt(2000, 47.5006, 19)];
    const r: MatchResult = { matchings: [{ confidence: 0.9, coords: [[47.5, 19], [47.5003, 19]], legsM: [33] }], tracepoints: [{ matching: 0, lat: 47.5, lon: 19 }, { matching: 0, lat: 47.5003, lon: 19 }, null] };
    const l = assembleLines([p], [r]);
    expect(l.map((x) => x.matched)).toEqual([true, false]);
    expect(l[1]!.coords[0]).toEqual(l[0]!.coords.at(-1));
  });
});

describe('AW24: útszakaszok', () => {
  it('az él 25 m-es darabokra, a végpontok az eredeti csúcsok; a kulcs irányfüggetlen és csúcsokhoz kötött', () => {
    const c = north(1, 100);
    const s = trackSegments([line(c)]);
    expect(s.length).toBe(4);
    for (const x of s) expect(haversineM({ lat: x.a[0], lon: x.a[1] }, { lat: x.b[0], lon: x.b[1] })).toBeCloseTo(25, 0);
    expect(s[0]!.a).toEqual(c[0]);
    expect(s.at(-1)!.b).toEqual(c[1]);
    expect(segmentKey(c[0]!, c[1]!)).toBe(segmentKey(c[1]!, c[0]!));
    const back = trackSegments([line([c[1]!, c[0]!])]);
    expect(back.map((x) => x.key).sort()).toEqual(s.map((x) => x.key).sort());
  });

  it('az út első és utolsó 300 m-e védett', () => {
    const s = trackSegments([line(north(40, 25))]);
    const free = s.filter((x) => !x.nearEnd);
    expect(s.length).toBe(40);
    expect(s.slice(0, 12).every((x) => x.nearEnd)).toBe(true);
    expect(s.slice(-12).every((x) => x.nearEnd)).toBe(true);
    expect(free.length).toBe(16);
  });

  it('feltöltés: csak illesztett szakasz, a védett és a zónás kimarad, a visszafelé ág is', () => {
    const c = north(60, 25);
    const start = 1_800_000_000_000;
    const rows = segmentUploadRows({ lines: [line(c)], startedAt: start }, 60);
    expect(rows.length).toBe(60 - 24);
    expect(Object.keys(rows[0]!).sort()).toEqual(['avg_speed', 'count', 'dow', 'hour', 'lat1', 'lat2', 'lon1', 'lon2', 'seg_key']);
    expect(segmentUploadRows({ lines: [line(c, false)], startedAt: start }, 60)).toEqual([]);
    const zone = { id: 'home', lat: c[30]![0], lon: c[30]![1], radiusM: 200 };
    const zoned = segmentUploadRows({ lines: [line(c)], startedAt: start }, 60, [zone]);
    expect(zoned.length).toBeLessThan(rows.length);
    for (const r of zoned) expect(haversineM({ lat: (r.lat1 + r.lat2) / 2, lon: (r.lon1 + r.lon2) / 2 }, zone)).toBeGreaterThan(200);
    // ha az út vége ráfordul a közepére, ott az egész szakasz védett
    const backOver = [...c, ...c.slice(30).reverse()];
    const returned = segmentUploadRows({ lines: [line(backOver)], startedAt: start }, 60);
    const protectedMid = c[36]!;
    expect(returned.some((r) => haversineM({ lat: r.lat1, lon: r.lon1 }, { lat: protectedMid[0], lon: protectedMid[1] }) < 100)).toBe(false);
  });

  it('a feltöltési sor sérült tartalomnál üres', () => {
    expect(parseSegmentOutbox('{x')).toEqual([]);
    expect(parseSegmentOutbox(JSON.stringify([{ seg_key: 'a', count: 1 }, { nope: 1 }])).length).toBe(1);
  });
});

describe('AW24: kirajzolás', () => {
  const vp = { zoom: 15, bbox: { south: 47.49, north: 47.52, west: 18.99, east: 19.01 } };

  it('egyetlen áthaladás is látható vonal, nem szürke; a több áthaladás nagyobb súlyú', () => {
    const i = new TrackIndex();
    const c = north(60, 25);
    i.add([line(c)]);
    const one = i.lines(vp, 'gyakorisag', []).filter((x) => !x.grey);
    expect(one.length).toBe(1);
    expect(one[0]!.weight).toBeGreaterThan(0);
    const w1 = one[0]!.weight;
    i.add([line(c)]);
    i.add([line(c)]);
    const three = i.lines(vp, 'gyakorisag', []).filter((x) => !x.grey);
    expect(Math.max(...three.map((x) => x.weight))).toBeGreaterThan(w1);
  });

  it('az azonos súlyú szomszédos szakaszok egy vonallá állnak, sorrendben', () => {
    const i = new TrackIndex();
    i.add([line(north(60, 25))]);
    const l = i.lines(vp, 'gyakorisag', []).filter((x) => !x.grey)[0]!;
    expect(l.coords.length).toBe(60 - 24 + 1);
    for (let k = 1; k < l.coords.length; k++) expect(haversineM({ lat: l.coords[k - 1]![0], lon: l.coords[k - 1]![1] }, { lat: l.coords[k]![0], lon: l.coords[k]![1] })).toBeCloseTo(25, 0);
  });

  it('átlagsebesség módban a sebesség adja a súlyt', () => {
    const slow = new TrackIndex();
    slow.add([line(north(60, 25), true, 30)]);
    const fast = new TrackIndex();
    fast.add([line(north(60, 25), true, 120)]);
    const w = (x: TrackIndex) => x.lines(vp, 'atlagsebesseg', []).filter((l) => !l.grey)[0]!.weight;
    expect(w(fast)).toBeGreaterThan(w(slow));
  });

  it('a zónán belül és az út végein szürke, a látható területen kívül semmi', () => {
    const i = new TrackIndex();
    const c = north(60, 25);
    i.add([line(c)]);
    const free = i.lines(vp, 'gyakorisag', []);
    expect(free.filter((x) => x.grey).length).toBe(2);
    const zone = { id: 'home', lat: c[30]![0], lon: c[30]![1], radiusM: 200 };
    const zoned = i.lines(vp, 'gyakorisag', [zone]);
    const greyLen = (l: typeof free) => l.filter((x) => x.grey).reduce((s, x) => s + lengthM(x.coords), 0);
    expect(greyLen(zoned)).toBeGreaterThan(greyLen(free) + 300);
    expect(i.lines({ zoom: 15, bbox: { south: 48, north: 48.1, west: 19, east: 19.1 } }, 'gyakorisag', [])).toEqual([]);
  });

  it('közösségi sorokból vonalak, szürke nélkül', () => {
    const rows = seedGlobalRows([[line(north(10, 25))], [line(north(10, 25))]]);
    expect(rows.length).toBe(10);
    expect(rows[0]!.count).toBe(2);
    const l = globalLines(rows, 'gyakorisag');
    expect(l.length).toBe(1);
    expect(l[0]!.grey).toBe(false);
    expect(l[0]!.coords.length).toBe(11);
    expect(HEAT.shareEndsM).toBe(300);
  });
});
