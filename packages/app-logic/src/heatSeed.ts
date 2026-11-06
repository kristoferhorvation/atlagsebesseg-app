import { gridLines } from './track';
import { haversineM } from '@atlagsebesseg/core';
import { mergePasses, type HeatCell, type HeatGlobalRow, type HeatGeo, type HeatPass } from './heat';
import type { TrackLine } from './track';

/**
 * AW20: mesterséges, több „utas” hőtérkép-adat a szimulátorhoz (`?heatSeed` / `-heatSeed YES`) – a nav-shots ezzel ellenőrzi
 * a réteg meglétét, a mód-váltót és a zoom-összevonást. Determinisztikus (a Swift-pár: `Logic/HeatSeed.swift`, azonos
 * nevű tesztekkel): Budapest → Győr (M1) és Budapest belső körei, 12 utas eltérő sebességgel. Éles használatban nincs.
 */
export const HEAT_SEED = { riders: 12, stepM: 55 } as const;

/** Az M1 nagyjából (Budapest → Biatorbágy → Tatabánya → Győr). */
const M1: [number, number][] = [
  [47.4979, 19.0402],
  [47.4725, 18.8237],
  [47.5605, 18.4021],
  [47.6892, 17.6342],
];
/** Egy belső kör Budapesten (Deák tér → Margit híd → Móricz Zsigmond körtér → Deák tér, durván). */
const CITY: [number, number][] = [
  [47.4975, 19.0545],
  [47.5136, 19.0407],
  [47.4796, 19.0388],
  [47.4789, 19.0613],
  [47.4975, 19.0545],
];
/** Egy rövid, ritkán használt szakasz (Szentendrei út felé). */
const SIDE: [number, number][] = [
  [47.5136, 19.0407],
  [47.5578, 19.0425],
  [47.6126, 19.0628],
];

/** AW24: a felvett utak (`fixtures/heat-seed-routes.json`) vonalai utanként: a `passes` adja az áthaladásokat, a sebesség utanként kicsit eltér. */
export function heatSeedTrackLines(routes: readonly { passes: number; kmh: number; coords: readonly (readonly number[])[] }[]): TrackLine[][] {
  const out: TrackLine[][] = [];
  routes.forEach((r, ri) => {
    for (let i = 0; i < r.passes; i++) {
      const kmh = r.kmh + ((i * 7 + ri * 3) % 13) - 6;
      // AW25: mint egy valódi út – a pontsor a saját rács-illesztőn át (`gridLines`)
      out.push(gridLines([r.coords.map((c, k) => ({ t: k * 1000, lat: c[0]!, lon: c[1]!, kmh, acc: 8 }))]));
    }
  });
  return out;
}

/** mulberry32 – egész aritmetika, hogy a Swift-pár bitre azonos számokat kapjon. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedPoint {
  lat: number;
  lon: number;
  /** A pont sebessége (km/h). */
  kmh: number;
  /** Az utas sorszáma. */
  rider: number;
}

/** Pontok a töröttvonal mentén `stepM` lépéssel, `from`–`to` hányad között (0…1). */
function along(line: readonly [number, number][], from: number, to: number): { lat: number; lon: number }[] {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = haversineM({ lat: line[i - 1]![0], lon: line[i - 1]![1] }, { lat: line[i]![0], lon: line[i]![1] });
    lens.push(d);
    total += d;
  }
  const out: { lat: number; lon: number }[] = [];
  for (let s = from * total; s <= to * total; s += HEAT_SEED.stepM) {
    let rest = s;
    let i = 0;
    while (i < lens.length - 1 && rest > lens[i]!) rest -= lens[i++]!;
    const f = Math.min(1, rest / lens[i]!);
    const a = line[i]!;
    const b = line[i + 1]!;
    out.push({ lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f });
  }
  return out;
}

/** Az összes utas pontjai (utasonként több áthaladás az M1-en, a városi körön és az oldalszakaszon). */
export function heatSeedPoints(): SeedPoint[] {
  const out: SeedPoint[] = [];
  for (let rider = 0; rider < HEAT_SEED.riders; rider++) {
    const r = rng(1000 + rider * 7919);
    const pace = 0.8 + r() * 0.4; // az utas „tempója”
    const m1Trips = 1 + Math.floor(r() * 4);
    for (let k = 0; k < m1Trips; k++) {
      const a = r() * 0.3;
      const b = 0.55 + r() * 0.45;
      for (const p of along(M1, a, b)) out.push({ ...p, kmh: Math.round((105 + r() * 25) * pace * 10) / 10, rider });
    }
    const loops = 1 + Math.floor(r() * 5);
    for (let k = 0; k < loops; k++) for (const p of along(CITY, 0, 1)) out.push({ ...p, kmh: Math.round((24 + r() * 26) * pace * 10) / 10, rider });
    if (rider % 3 === 0) for (const p of along(SIDE, 0, 1)) out.push({ ...p, kmh: Math.round((55 + r() * 20) * pace * 10) / 10, rider });
  }
  return out;
}

/** A pontokból cellák (`cellOf`: a platform H3-a); a cellánként egymás utáni pontok egy áthaladás, a pontok időbélyege a sorrendjük. */
export function heatSeedCells(cellOf: (lat: number, lon: number) => string | null): HeatCell[] {
  const cells = new Map<string, HeatCell>();
  const passes: HeatPass[] = [];
  let run: { h3: string; rider: number; sum: number; n: number } | null = null;
  const flush = (t: number) => {
    if (run && run.n > 0) passes.push({ h3: run.h3, avgKmh: Math.round((run.sum / run.n) * 10) / 10, t, fromStartM: 1000, toEndM: 1000 });
    run = null;
  };
  let t = 1_790_000_000_000;
  for (const p of heatSeedPoints()) {
    t += 1000;
    const h3 = cellOf(p.lat, p.lon);
    if (h3 === null) continue;
    if (run && run.h3 === h3 && run.rider === p.rider) {
      run.sum += p.kmh;
      run.n++;
    } else {
      flush(t);
      run = { h3, rider: p.rider, sum: p.kmh, n: 1 };
    }
  }
  flush(t);
  mergePasses(cells, passes);
  return [...cells.values()];
}

/** A közösségi nézet sorai a mesterséges cellákból (hálózat nélkül): a darabszám az „utasok” miatt szorozva. */
export function heatSeedGlobal(cells: readonly HeatCell[], geo: HeatGeo, res: number): HeatGlobalRow[] {
  const byParent = new Map<string, { sumLat: number; sumLon: number; n: number; count: number; speed: number }>();
  for (const c of cells) {
    const h3 = res >= 10 ? c.h3 : geo.parent(c.h3, res);
    const p = geo.center(c.h3);
    const g = byParent.get(h3) ?? { sumLat: 0, sumLon: 0, n: 0, count: 0, speed: 0 };
    g.sumLat += p.lat;
    g.sumLon += p.lon;
    g.n++;
    g.count += c.count * 3;
    g.speed += c.avgKmh * c.count * 3;
    byParent.set(h3, g);
  }
  return [...byParent.entries()].map(([h3, g]) => ({ h3, lat: g.sumLat / g.n, lon: g.sumLon / g.n, count: g.count, avg_speed: Math.round((g.speed / g.count) * 10) / 10 }));
}
