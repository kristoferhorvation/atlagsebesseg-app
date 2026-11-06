import { describe, expect, it } from 'vitest';
import { bearingDeg, haversineM, type LatLon } from '@atlagsebesseg/core';
import { globalLines, gridLines, gridMatcher, HEAT, MATCHER_GRID, MATCHER_MAPBOX, migrateTrack, parseSegmentOutbox, recordTrace, segmentKey, segmentUploadRows, seedGlobalRows, smoothLine, TRACK, TrackIndex, trackSegments, type TrackLine, type TrackMatcher, type TrackPoint, type TripSample, type TripTrack } from '../src';
import fixture from '../src/fixtures/track-budapest.json';
import roadsFile from '../src/fixtures/track-budapest-roads.json';

const samples: TripSample[] = fixture.samples.map(([t, lat, lon, kmh]) => ({ tripId: 'budapest', t: t!, lat: lat!, lon: lon!, speedKmh: kmh!, heading: null, accuracy: 8, h3: null, limitKmh: null }));
const parts = recordTrace(samples);
/** AW25: a csík a saját rács-illesztővel a nyers pontokból (Map Matching nélkül). */
const lines = gridLines(parts);

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

describe('AW25: valódi budapesti nyomat, saját rács-illesztő', () => {
  it('a csík a nyers pontokból, az utcán halad: a csúcsok a cellán belül az OSM-úthálózat mellett', () => {
    const vertices = lines.flatMap((l) => l.coords);
    expect(vertices.length).toBeGreaterThan(30);
    expect(lines.every((l) => l.matched)).toBe(true);
    for (const [lat, lon] of vertices) expect(roadDist({ lat, lon })).toBeLessThan(25);
    const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
    expect(avg(vertices.map(([lat, lon]) => roadDist({ lat, lon })))).toBeLessThan(10);
  });

  it('a kanyart követi: a kirajzolt vonal irányt vált (40 m-enként mérve)', () => {
    // a simított vonal csúcsai sűrűk: 40 m-enként újramintázva mérünk
    const all = smoothLine(lines[0]!.coords);
    const c: [number, number][] = [all[0]!];
    for (const x of all) if (haversineM({ lat: c.at(-1)![0], lon: c.at(-1)![1] }, { lat: x[0], lon: x[1] }) >= 40) c.push(x);
    let turns = 0;
    let prev: number | null = null;
    for (let i = 1; i < c.length; i++) {
      const b = bearingDeg({ lat: c[i - 1]![0], lon: c[i - 1]![1] }, { lat: c[i]![0], lon: c[i]![1] });
      if (prev !== null && Math.abs(((b - prev + 540) % 360) - 180) > 45) turns++;
      prev = b;
    }
    expect(turns).toBeGreaterThanOrEqual(2);
  });

  it('két áthaladás ugyanazon az utcán (eltolt GPS-zajjal) többnyire ugyanazokat a szakaszkulcsokat adja', () => {
    const shifted = recordTrace(samples.map((x, i) => ({ ...x, lat: x.lat + ((i % 3) - 1) * 0.00002, lon: x.lon + ((i % 2) * 2 - 1) * 0.00002 })));
    const a = new Set(trackSegments(lines).map((s) => s.key));
    const b = trackSegments(gridLines(shifted)).map((s) => s.key);
    expect(b.filter((k) => a.has(k)).length / b.length).toBeGreaterThan(0.7);
  });

  it('a megfordulásnál nincs kerülő: a csík hossza a nyers nyomat körül marad', () => {
    const rawLen = parts.reduce((s, p) => s + lengthM(p.map((x) => [x.lat, x.lon])), 0);
    expect(lines.reduce((s, l) => s + lengthM(smoothLine(l.coords)), 0)).toBeLessThan(rawLen * 1.25);
    const uturn = fixture.samples.find((s) => s[0] === fixture.uturnT)!;
    expect(lines.some((l) => l.coords.some(([lat, lon]) => haversineM({ lat, lon }, { lat: uturn[1]!, lon: uturn[2]! }) < 40))).toBe(true);
  });

  it('a GPS-kiesésnél megszakad: két darab, köztük nincs vonal', () => {
    expect(parts.length).toBe(2);
    const a = parts[0]!.at(-1)!;
    const b = parts[1]![0]!;
    expect(a.t).toBe(fixture.gap!.beforeT);
    expect(b.t).toBe(fixture.gap!.afterT);
    expect(haversineM(a, b)).toBeGreaterThan(TRACK.gapM);
    expect(lines.length).toBe(2);
    const crossing = lines.some((l) => l.coords.some(([lat, lon]) => haversineM({ lat, lon }, a) < 30) && l.coords.some(([lat, lon]) => haversineM({ lat, lon }, b) < 30));
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
});

describe('AW25: illesztő-réteg (saját, cserélhető)', () => {
  it('a rács-illesztő: a cellasor folytonos (szomszédos cellák), a cellaközéppont a rácsé, a visszalépés kimarad', async () => {
    const p = north(40, 5).map(([lat, lon], i) => pt(i * 1000, lat, lon));
    const l = await gridMatcher.lines([p]);
    expect(gridMatcher.id).toBe(MATCHER_GRID);
    expect(l.length).toBe(1);
    for (let i = 1; i < l[0]!.coords.length; i++) expect(haversineM({ lat: l[0]!.coords[i - 1]![0], lon: l[0]!.coords[i - 1]![1] }, { lat: l[0]!.coords[i]![0], lon: l[0]!.coords[i]![1] })).toBeLessThan(32);
    // a cellahatáron oda-vissza ugráló pont nem ad A–B–A lépcsőt
    const edge = Math.floor(47.5 / TRACK.gridDeg + 1) * TRACK.gridDeg;
    const jitter = [pt(0, edge - 0.00003, 19), pt(1000, edge + 0.00001, 19), pt(2000, edge - 0.00002, 19), pt(3000, edge - 0.0001, 19)];
    expect(gridLines([jitter])).toEqual([]);
  });

  it('másik illesztő ugyanazon a felületen cserélhető', async () => {
    const p = north(2, 50).map(([lat, lon], i) => pt(i * 1000, lat, lon));
    const other: TrackMatcher = { id: 'valhalla', lines: async (ps) => ps.map((x) => ({ matched: true, coords: x.map((y) => [y.lat, y.lon] as [number, number]), kmh: x.map((y) => y.kmh ?? 0) })) };
    const l = await other.lines([p]);
    expect(l.length).toBe(1);
    expect(l[0]!.matched).toBe(true);
  });

  it('a tárolt Mapbox-illesztés cseréje: nyers pontsorral újraépül, nélküle a geometria törlődik; a rács-illesztett és a függő változatlan', () => {
    const base: TripTrack = { tripId: 't', startedAt: 0, status: 'done', share: false, parts, lines: [line([[47.5, 19], [47.51, 19]])], matcher: MATCHER_MAPBOX };
    const re = migrateTrack(base);
    expect(re.matcher).toBe(MATCHER_GRID);
    expect(re.lines).toEqual(gridLines(parts));
    const gone = migrateTrack({ ...base, parts: [] });
    expect(gone.lines).toEqual([]);
    expect(gone.matcher).toBe(MATCHER_GRID);
    const ok = { ...base, matcher: MATCHER_GRID };
    expect(migrateTrack(ok)).toBe(ok);
    const pending = { ...base, status: 'pending' as const };
    expect(migrateTrack(pending)).toBe(pending);
    // a régi, illesztés nélküli egyenes is a rácsra kerül (stabil kulcsok); nyers pontsor nélkül marad
    expect(migrateTrack({ ...base, matcher: null }).matcher).toBe(MATCHER_GRID);
    const bare = { ...base, matcher: null, parts: [] };
    expect(migrateTrack(bare)).toBe(bare);
  });

  it('kirajzolás: a lépcső simított, a végpontok maradnak, két pontnál változatlan', () => {
    const stair: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]];
    const sm = smoothLine(stair);
    expect(sm[0]).toEqual([0, 0]);
    expect(sm.at(-1)).toEqual([2, 2]);
    expect(sm.length).toBeGreaterThan(stair.length);
    expect(smoothLine([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
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
