import { describe, expect, it } from 'vitest';
import {
  appendHeatOutbox,
  coarsenCells,
  endCells,
  globalPoints,
  HEAT,
  HeatGlobalCache,
  HeatIndex,
  heatQueryBox,
  heatQueryKey,
  heatResForZoom,
  heatWeight,
  mergePasses,
  parseHeatOutbox,
  parseSettings,
  speedRuns,
  speedTone,
  tripPasses,
  uploadRows,
  type HeatCell,
  type HeatGeo,
  type HeatPass,
  type TripSample,
  heatSeedCells,
  heatSeedGlobal,
  heatSeedPoints,
} from '../src';

// AW20: hőtérkép (a Swift-pár: AtlagsebessegTests/HeatTests.swift, azonos nevekkel)

const T0 = Date.UTC(2026, 10, 2, 8, 30, 0); // 2026-11-02 (hétfő) 08:30 UTC
const DEG_M = 111_195;

/** Teszt-H3: a cella azonosítója „r<sor>c<oszlop>”, a középpont egy 0,001°-os rácson; a szülő 10×10 cellát fog össze. */
const geo: HeatGeo = {
  center: (h3) => {
    const m = /^c(\d+)_(\d+)$/.exec(h3)!;
    return { lat: 47 + Number(m[1]) * 0.001, lon: 19 + Number(m[2]) * 0.001 };
  },
  parent: (h3, res) => {
    const m = /^c(\d+)_(\d+)$/.exec(h3);
    if (!m) return h3;
    return `p${res}_${Math.floor(Number(m[1]) / 10)}_${Math.floor(Number(m[2]) / 10)}`;
  },
};
// a szülő középpontja a `center`-en át: egy `p…` azonosítóra is működjön
const geoP: HeatGeo = {
  center: (h3) => {
    const m = /^p\d+_(\d+)_(\d+)$/.exec(h3);
    if (m) return { lat: 47 + Number(m[1]) * 0.01 + 0.005, lon: 19 + Number(m[2]) * 0.01 + 0.005 };
    return geo.center(h3);
  },
  parent: geo.parent,
};

/** Észak felé 1 Hz-es minták; minden `cellM` méteren új cella; a sebesség km/h. */
function drive(opts: { meters: number; kmh: number; cellM?: number; t0?: number; lat0?: number; prefix?: string }): TripSample[] {
  const out: TripSample[] = [];
  const mps = opts.kmh / 3.6;
  const cellM = opts.cellM ?? 100;
  const n = Math.round(opts.meters / mps);
  for (let i = 0; i <= n; i++) {
    const d = i * mps;
    out.push({
      tripId: 'trip-1',
      t: (opts.t0 ?? T0) + i * 1000,
      lat: (opts.lat0 ?? 47) + d / DEG_M,
      lon: 19,
      speedKmh: opts.kmh,
      heading: 0,
      accuracy: 5,
      h3: `c${Math.floor(d / cellM)}_0`,
      limitKmh: null,
    });
  }
  return out;
}

describe('tripPasses', () => {
  it('egymás utáni, azonos cellájú minták egy áthaladás', () => {
    const passes = tripPasses(drive({ meters: 1000, kmh: 72, cellM: 100 }));
    expect(passes.map((p) => p.h3)).toEqual(['c0_0', 'c1_0', 'c2_0', 'c3_0', 'c4_0', 'c5_0', 'c6_0', 'c7_0', 'c8_0', 'c9_0', 'c10_0']);
    expect(passes[3]!.avgKmh).toBe(72);
  });

  it('az álló minták nem számítanak áthaladásnak', () => {
    const s = drive({ meters: 500, kmh: 36, cellM: 100 });
    const parked = s.map((x, i) => (i > 20 ? { ...x, speedKmh: 0, h3: 'c99_9' } : x));
    expect(tripPasses(parked).some((p) => p.h3 === 'c99_9')).toBe(false);
  });

  it('a cella átlaga a mozgó mintákból számol', () => {
    const s = drive({ meters: 90, kmh: 36, cellM: 100 }); // egy cella
    const mixed = s.map((x, i) => ({ ...x, speedKmh: i % 2 === 0 ? 40 : 80 }));
    const p = tripPasses(mixed);
    expect(p).toHaveLength(1);
    expect(p[0]!.avgKmh).toBeGreaterThan(55);
    expect(p[0]!.avgKmh).toBeLessThan(65);
  });

  it('a cella nélküli (h3 = null) minta kimarad, üres bemenet üres', () => {
    expect(tripPasses([])).toEqual([]);
    expect(tripPasses(drive({ meters: 300, kmh: 36 }).map((x) => ({ ...x, h3: null })))).toEqual([]);
  });

  it('a távolság az út elejétől és végéig a mintákból számol', () => {
    const passes = tripPasses(drive({ meters: 1000, kmh: 72, cellM: 100 }));
    expect(passes[0]!.fromStartM).toBe(0);
    expect(passes[5]!.fromStartM).toBeGreaterThan(450);
    expect(passes[5]!.fromStartM).toBeLessThan(560);
    expect(passes.at(-1)!.toEndM).toBeLessThan(1);
  });

  it('ugyanabba a cellába 2 perc után visszatérve új áthaladás', () => {
    const a = drive({ meters: 50, kmh: 36, cellM: 1000 });
    const b = drive({ meters: 50, kmh: 36, cellM: 1000, t0: T0 + 300_000 });
    expect(tripPasses([...a, ...b]).map((p) => p.h3)).toEqual(['c0_0', 'c0_0']);
  });
});

describe('mergePasses', () => {
  const pass = (h3: string, avgKmh: number, t: number): HeatPass => ({ h3, avgKmh, t, fromStartM: 1000, toEndM: 1000 });

  it('új cella: az első áthaladás értékei', () => {
    const cells = new Map<string, HeatCell>();
    const changed = mergePasses(cells, [pass('c1_1', 50, 10)]);
    expect(cells.get('c1_1')).toEqual({ h3: 'c1_1', count: 1, avgKmh: 50, lastT: 10 });
    expect(changed).toHaveLength(1);
  });

  it('meglévő cella: a darabszám nő, az átlag súlyozott, az utolsó idő a legnagyobb', () => {
    const cells = new Map<string, HeatCell>([['c1_1', { h3: 'c1_1', count: 3, avgKmh: 60, lastT: 100 }]]);
    mergePasses(cells, [pass('c1_1', 100, 50)]);
    expect(cells.get('c1_1')).toEqual({ h3: 'c1_1', count: 4, avgKmh: 70, lastT: 100 });
  });

  it('csak a módosult cellákat adja vissza, ugyanazt kétszer is egybe fogva', () => {
    const cells = new Map<string, HeatCell>([['c9_9', { h3: 'c9_9', count: 1, avgKmh: 10, lastT: 1 }]]);
    const changed = mergePasses(cells, [pass('c1_1', 50, 10), pass('c1_1', 70, 20)]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toEqual({ h3: 'c1_1', count: 2, avgKmh: 60, lastT: 20 });
  });
});

describe('közösségi feltöltés', () => {
  const tz = 60; // CET
  const passes = tripPasses(drive({ meters: 2000, kmh: 72, cellM: 100 }));

  it('az út első és utolsó 300 m-ének cellái kimaradnak', () => {
    const blocked = endCells(passes);
    expect(blocked.has('c0_0')).toBe(true);
    expect(blocked.has('c2_0')).toBe(true);
    expect(blocked.has('c10_0')).toBe(false);
    expect(blocked.has('c20_0')).toBe(true);
    const rows = uploadRows(passes, geo, tz);
    const cells = new Set(rows.map((r) => r.h3));
    expect(cells.has('c1_0')).toBe(false);
    expect(cells.has('c10_0')).toBe(true);
    expect(cells.has('c19_0')).toBe(false);
  });

  it('egy rövid út (600 m alatt) szinte semmit sem tölt fel, a 300 m-es sáv közepe sem', () => {
    const short = tripPasses(drive({ meters: 500, kmh: 36, cellM: 100 }));
    expect(uploadRows(short, geo, tz)).toEqual([]);
  });

  it('a védett cella minden áthaladása kimarad, ha egyszer az út végén járt', () => {
    const loop: HeatPass[] = [
      { h3: 'c5_5', avgKmh: 40, t: T0, fromStartM: 100, toEndM: 5000 },
      { h3: 'c6_6', avgKmh: 40, t: T0 + 1000, fromStartM: 2000, toEndM: 3000 },
      { h3: 'c5_5', avgKmh: 40, t: T0 + 2000, fromStartM: 4900, toEndM: 100 },
    ];
    expect(uploadRows(loop, geo, tz).map((r) => r.h3)).toEqual(['c6_6']);
  });

  it('a sor csak aggregátum: cella, darabszám, átlag, óra, nap – a helyi időzónában', () => {
    const rows = uploadRows(passes, geo, tz);
    const r = rows.find((x) => x.h3 === 'c10_0')!;
    expect(Object.keys(r).sort()).toEqual(['avg_speed', 'count', 'dow', 'h3', 'h3_r8', 'hour', 'lat', 'lon']);
    expect(r.hour).toBe(9); // 08:30 UTC + 1 óra
    expect(r.dow).toBe(1); // hétfő
    expect(r.count).toBe(1);
    expect(r.avg_speed).toBe(72);
    expect(r.h3_r8).toBe('p8_1_0');
    expect(r.lat).toBeCloseTo(47.01, 5);
  });

  it('az azonos (cella, óra, nap) áthaladások egy sorba vonódnak', () => {
    const many: HeatPass[] = [10, 20, 30].map((v, i) => ({ h3: 'c50_5', avgKmh: v, t: T0 + i * 60_000, fromStartM: 5000, toEndM: 5000 }));
    const rows = uploadRows(many, geo, tz);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(3);
    expect(rows[0]!.avg_speed).toBe(20);
  });

  it('a pontos idő nem szivárog: a sorokban nincs időbélyeg, az órasáv egész óra', () => {
    for (const r of uploadRows(passes, geo, tz)) {
      expect(Number.isInteger(r.hour)).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/\d{10,}/);
    }
  });

  it('a feltöltés-várólista sérült tartalomnál üres, és a határnál a legrégebbiek esnek ki', () => {
    expect(parseHeatOutbox('nem json')).toEqual([]);
    expect(parseHeatOutbox(null)).toEqual([]);
    const row = uploadRows(passes, geo, tz)[0]!;
    expect(parseHeatOutbox(JSON.stringify([row, { x: 1 }]))).toEqual([row]);
    const big = Array.from({ length: HEAT.outboxMax }, () => row);
    expect(appendHeatOutbox(big, [{ ...row, count: 9 }, { ...row, count: 8 }])).toHaveLength(HEAT.outboxMax);
    expect(appendHeatOutbox(big, [{ ...row, count: 9 }]).at(-1)!.count).toBe(9);
  });
});

describe('megjelenítés', () => {
  const cell = (h3: string, count: number, avgKmh = 50): HeatCell => ({ h3, count, avgKmh, lastT: 0 });

  it('zoom-függő felbontás: közelről 10, kicsinyítve 8', () => {
    expect(heatResForZoom(15)).toBe(10);
    expect(heatResForZoom(12.5)).toBe(10);
    expect(heatResForZoom(12.4)).toBe(8);
    expect(heatResForZoom(7)).toBe(8);
  });

  it('a súly: gyakoriságnál a logaritmikus darabszám, sebességnél az átlag a skálán', () => {
    expect(heatWeight(cell('a', 1), 'gyakorisag')).toBeGreaterThan(0);
    expect(heatWeight(cell('a', 1), 'gyakorisag')).toBeLessThan(heatWeight(cell('a', 5), 'gyakorisag'));
    expect(heatWeight(cell('a', 500), 'gyakorisag')).toBe(1);
    expect(heatWeight(cell('a', 1, 65), 'atlagsebesseg')).toBeCloseTo(0.5, 5);
    expect(heatWeight(cell('a', 1, 300), 'atlagsebesseg')).toBe(1);
  });

  it('az összevonás súlyozott átlagot és összegzett darabszámot ad', () => {
    const out = coarsenCells([cell('c1_1', 1, 40), cell('c2_2', 3, 80), cell('c55_5', 2, 100)], geo);
    expect(out).toHaveLength(2);
    const p = out.find((c) => c.h3 === 'p8_0_0')!;
    expect(p.count).toBe(4);
    expect(p.avgKmh).toBe(70);
  });

  it('közelről res-10 pontok, csak a látható téglalapban', () => {
    const idx = new HeatIndex(geoP);
    idx.setAll([cell('c10_10', 1), cell('c500_500', 1)]);
    const vp = { zoom: 15, bbox: { south: 46.99, north: 47.03, west: 18.99, east: 19.03 } };
    const r = idx.points(vp, 'gyakorisag');
    expect(r.res).toBe(10);
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.lat).toBeCloseTo(47.01, 5);
  });

  it('kicsinyítve res-8-ra összevont pontok', () => {
    const idx = new HeatIndex(geoP);
    idx.setAll([cell('c1_1', 1), cell('c2_2', 1), cell('c3_3', 1)]);
    const r = idx.points({ zoom: 9, bbox: { south: 46.9, north: 47.1, west: 18.9, east: 19.1 } }, 'gyakorisag');
    expect(r.res).toBe(8);
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.weight).toBeCloseTo(heatWeight({ count: 3, avgKmh: 50 }, 'gyakorisag'), 5);
  });

  it('közelről is res-8-ra vált, ha a látható rész a pontplafonnál több cellát tartalmazna', () => {
    const idx = new HeatIndex(geoP);
    const cells: HeatCell[] = [];
    for (let r = 0; r < 70; r++) for (let c = 0; c < 70; c++) cells.push(cell(`c${r}_${c}`, 1));
    idx.setAll(cells);
    expect(cells.length).toBeGreaterThan(HEAT.maxFeatures);
    const r = idx.points({ zoom: 14, bbox: { south: 46.9, north: 47.2, west: 18.9, east: 19.2 } }, 'gyakorisag');
    expect(r.res).toBe(8);
    expect(r.points.length).toBeLessThan(HEAT.maxFeatures);
  });

  it('az upsert után a res-8 összesítés újraépül (inkrementális frissítés)', () => {
    const idx = new HeatIndex(geoP);
    idx.setAll([cell('c1_1', 1)]);
    const vp = { zoom: 9, bbox: { south: 46.9, north: 47.1, west: 18.9, east: 19.1 } };
    expect(idx.points(vp, 'gyakorisag').points[0]!.weight).toBeCloseTo(heatWeight({ count: 1, avgKmh: 50 }, 'gyakorisag'), 5);
    idx.upsert([cell('c1_1', 9), cell('c2_2', 1)]);
    expect(idx.size).toBe(2);
    expect(idx.points(vp, 'gyakorisag').points[0]!.weight).toBeCloseTo(heatWeight({ count: 10, avgKmh: 50 }, 'gyakorisag'), 5);
  });
});

describe('közösségi lekérés', () => {
  it('a lekérés téglalapja a rácsra kerekített, kifelé; a kis mozgatás ugyanaz a kulcs', () => {
    const a = heatQueryBox({ south: 47.4, north: 47.5, west: 19.0, east: 19.1 });
    const b = heatQueryBox({ south: 47.401, north: 47.501, west: 19.001, east: 19.101 });
    expect(heatQueryKey(a, 10)).toBe(heatQueryKey(b, 10));
    expect(a.south).toBeLessThanOrEqual(47.4);
    expect(a.north).toBeGreaterThanOrEqual(47.5);
    expect(heatQueryKey(a, 8)).not.toBe(heatQueryKey(a, 10));
  });

  it('a gyorsítótár 10 percig tart', () => {
    let now = 1000;
    const cache = new HeatGlobalCache(() => now);
    const rows = [{ h3: 'x', lat: 47, lon: 19, count: 3, avg_speed: 60 }];
    cache.set('k', rows);
    now += 9 * 60_000;
    expect(cache.get('k')).toBe(rows);
    now += 2 * 60_000;
    expect(cache.get('k')).toBeNull();
    expect(cache.get('nincs')).toBeNull();
  });

  it('a közösségi sorokból súlyozott pontok lesznek', () => {
    const pts = globalPoints([{ h3: 'x', lat: 47, lon: 19, count: 4, avg_speed: 65 }], 'atlagsebesseg');
    expect(pts).toEqual([{ lat: 47, lon: 19, weight: 0.5 }]);
  });
});

describe('beállítások', () => {
  it('a hőtérkép alapból saját, gyakoriság; a megosztás alapból KI', () => {
    const s = parseSettings(null);
    expect(s.hoterkep).toBe('sajat');
    expect(s.hoterkep_nezet).toBe('gyakorisag');
    expect(s.adatmegosztas).toBe(false);
  });

  it('érvénytelen érték helyett az alapértelmezés, érvényes megmarad', () => {
    expect(parseSettings(JSON.stringify({ hoterkep: 'kozossegi', hoterkep_nezet: 'atlagsebesseg', adatmegosztas: true }))).toMatchObject({
      hoterkep: 'kozossegi',
      hoterkep_nezet: 'atlagsebesseg',
      adatmegosztas: true,
    });
    expect(parseSettings(JSON.stringify({ hoterkep: 'x', hoterkep_nezet: 7, adatmegosztas: 'igen' }))).toMatchObject({ hoterkep: 'sajat', hoterkep_nezet: 'gyakorisag', adatmegosztas: false });
  });
});

describe('az út színezése', () => {
  it('limit mellett a limithez képest: 90% alatt zöld, a limitnél sárga, 115% fölött piros', () => {
    expect(speedTone(80, 100)).toBe(0);
    expect(speedTone(90, 100)).toBe(0);
    expect(speedTone(100, 100)).toBeCloseTo(0.5, 5);
    expect(speedTone(115, 100)).toBe(1);
    expect(speedTone(140, 100)).toBe(1);
    expect(speedTone(95, 100)).toBeCloseTo(0.25, 5);
  });

  it('limit nélkül abszolút skálán: 50 alatt zöld, 90 sárga, 130 fölött piros', () => {
    expect(speedTone(30, null)).toBe(0);
    expect(speedTone(90, null)).toBeCloseTo(0.5, 5);
    expect(speedTone(130, null)).toBe(1);
    expect(speedTone(70, null)).toBeCloseTo(0.25, 5);
  });

  it('a szakaszok az azonos fokozatú mintákból állnak, közös ponttal kapcsolódnak', () => {
    const s = drive({ meters: 600, kmh: 36 });
    const mixed = s.map((x, i) => ({ ...x, speedKmh: i < 30 ? 60 : 130, limitKmh: 100 }));
    const runs = speedRuns(mixed);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]!.tone).toBe(0);
    expect(runs.at(-1)!.tone).toBe(1);
    expect(runs[1]!.points[0]).toEqual(runs[0]!.points.at(-1));
  });

  it('ugrásnál és nagy résnél új szakasz, pontatlan minta kimarad', () => {
    const a = drive({ meters: 200, kmh: 36 });
    const b = drive({ meters: 200, kmh: 36, t0: T0 + 120_000, lat0: 47.2 });
    expect(speedRuns([...a, ...b])).toHaveLength(2);
    const noisy = a.map((x, i) => (i === 5 ? { ...x, accuracy: 200, lat: 48 } : x));
    expect(speedRuns(noisy)).toHaveLength(1);
  });

  it('a sebesség nélküli minta az előző színét kapja', () => {
    const s = drive({ meters: 300, kmh: 36 }).map((x, i) => ({ ...x, speedKmh: i === 10 ? null : 36, limitKmh: null }));
    expect(speedRuns(s)).toHaveLength(1);
  });
});

// a rácsos teszt-H3 a mesterséges adat (Budapest–Győr) tartományára: a szülő 10×10 cella
const geo2: HeatGeo = {
  center: (h3) => {
    const m = /^c(\d+)_(\d+)$/.exec(h3)!;
    return { lat: 46 + Number(m[1]) * 0.001, lon: 17 + Number(m[2]) * 0.001 };
  },
  parent: (h3, res) => {
    const m = /^c(\d+)_(\d+)$/.exec(h3)!;
    return `p${res}_${Math.floor(Number(m[1]) / 10)}_${Math.floor(Number(m[2]) / 10)}`;
  },
};

describe('mesterséges adat (heatSeed)', () => {
  it('a mesterséges pontok determinisztikusak', () => {
    expect(heatSeedPoints()).toEqual(heatSeedPoints());
    expect(heatSeedPoints().length).toBeGreaterThan(1000);
  });

  it('a mesterséges cellák Budapest és Győr között húzódnak, az M1 gyorsabb a városnál', () => {
    const cells = heatSeedCells((lat, lon) => `${Math.round(lat * 1000)}:${Math.round(lon * 1000)}`);
    expect(cells.length).toBeGreaterThan(1500);
    const m1 = cells.filter((c) => Number(c.h3.split(':')[1]) < 18500);
    const city = cells.filter((c) => Number(c.h3.split(':')[1]) >= 19030 && Number(c.h3.split(':')[0]) < 47510 && Number(c.h3.split(':')[0]) > 47470);
    const avg = (l: HeatCell[]) => l.reduce((s, c) => s + c.avgKmh, 0) / l.length;
    expect(avg(m1)).toBeGreaterThan(avg(city) + 40);
    expect(Math.max(...cells.map((c) => c.count))).toBeGreaterThan(3);
  });

  it('a közösségi sorok a res-8 összevonásnál kevesebb, de súlyosabb cellát adnak', () => {
    const cells = heatSeedCells((lat, lon) => `c${Math.floor((lat - 46) / 0.001)}_${Math.floor((lon - 17) / 0.001)}`);
    const fine = heatSeedGlobal(cells, geo2, 10);
    const coarse = heatSeedGlobal(cells, geo2, 8);
    expect(coarse.length).toBeLessThan(fine.length);
    expect(coarse.reduce((s, r) => s + r.count, 0)).toBe(fine.reduce((s, r) => s + r.count, 0));
  });
});
