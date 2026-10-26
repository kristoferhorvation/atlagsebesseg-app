import { bearingDeg, LocalProjection, polylineLengthM, type XY } from '../../src/geo';
import { Route } from '../../src/route';
import type { GpsFix, LatLon, Section } from '../../src/types';

/** Szintetikus pálya origója (Emilia-Romagna környéke – csak a szélesség miatt reális). */
export const ORIGIN: LatLon = { lat: 44.5, lon: 11.3 };
export const proj = new LocalProjection(ORIGIN);

export const toLatLon = (pts: XY[]) => pts.map((p) => proj.fromXY(p));

/** Ív pontjai a középpont körül, `from`→`to` szögig (radián, matematikai irány), `step` méterenként. */
export function arc(center: XY, radius: number, from: number, to: number, step = 50): XY[] {
  const n = Math.max(2, Math.ceil((Math.abs(to - from) * radius) / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
}

export function line(a: XY, b: XY, step = 100): XY[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

export function concat(...parts: XY[][]): XY[] {
  const out: XY[] = [];
  for (const part of parts) for (const p of part) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.01) out.push(p);
  }
  return out;
}

/** Párhuzamos eltolás: pozitív = a haladási iránytól jobbra. */
export function offset(pts: XY[], d: number): XY[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // jobb oldali normális: (dy, -dx)
    return { x: p.x + (d * (b.y - a.y)) / len, y: p.y - (d * (b.x - a.x)) / len };
  });
}

/**
 * Tesztszakasz: 4 km egyenes észak felé, 90°-os ív (R = 3000 m) kelet felé,
 * majd egyenes, összesen pontosan 10 000 m. Előtte 3 km rávezető, utána 2 km kivezető.
 */
export function testCourse() {
  const R = 3000;
  const arcLen = (Math.PI / 2) * R;
  const tail = 10_000 - 4000 - arcLen;
  const sectionXY = concat(
    line({ x: 0, y: 0 }, { x: 0, y: 4000 }),
    arc({ x: R, y: 4000 }, R, Math.PI, Math.PI / 2),
    line({ x: R, y: 4000 + R }, { x: R + tail, y: 4000 + R }),
  );
  const leadIn = line({ x: 0, y: -3000 }, { x: 0, y: 0 });
  const leadOut = line({ x: R + tail, y: 4000 + R }, { x: R + tail + 2000, y: 4000 + R });
  const sectionPts = toLatLon(sectionXY);
  const section: Section = {
    id: 'TEST-1',
    country: 'IT',
    road: 'A99',
    direction: 'Dél → Kelet',
    start: sectionPts[0]!,
    end: sectionPts[sectionPts.length - 1]!,
    lengthM: polylineLengthM(sectionPts),
    speedLimitKmh: 130,
    source: 'osm',
    verified: false,
    geometry: sectionPts,
  };
  return { section, sectionXY, leadIn, leadOut, fullXY: concat(leadIn, sectionXY, leadOut), leadInM: 3000 };
}

/** Egyszerű, determinisztikus PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DriveOptions {
  path: LatLon[];
  /** Sebesség (km/h) a pálya menti távolság (m) függvényében. */
  speedKmh: (s: number) => number;
  t0?: number;
  sampleMs?: number;
  noiseM?: number;
  accuracy?: number;
  seed?: number;
  /** Ebben a pálya menti tartományban nem jön fix (alagút). */
  dropRanges?: [number, number][];
  /** Ezeknél a mintaindexeknél a fix `jumpM` méterrel arrébb ugrik. */
  jumpAt?: number[];
  jumpM?: number;
  /** Megállás (dugó): az `atS` pozícióban `durationMs` ideig áll a jármű. */
  pauses?: { atS: number; durationMs: number }[];
}

export interface DriveSample {
  fix: GpsFix;
  /** Valódi pálya menti távolság (m). */
  s: number;
  /** Valódi idő (ms). */
  t: number;
  dropped: boolean;
}

/** Végigvezet a pályán, és másodpercenként GPS-fixet állít elő (opcionális zajjal, kieséssel, ugrással). */
export function drive(o: DriveOptions): DriveSample[] {
  const route = new Route(o.path);
  const total = route.lengthM;
  const dt = o.sampleMs ?? 1000;
  const rand = rng(o.seed ?? 1);
  const out: DriveSample[] = [];
  let s = 0;
  let t = o.t0 ?? 1_700_000_000_000;
  let i = 0;
  const pauses = [...(o.pauses ?? [])];
  let pausedUntil = -Infinity;
  while (s <= total) {
    const pause = pauses[0];
    if (pause && s >= pause.atS) {
      pauses.shift();
      pausedUntil = t + pause.durationMs;
    }
    const v = t < pausedUntil ? 0 : o.speedKmh(s) / 3.6;
    const truePt = route.pointAt(s);
    let pt = truePt;
    if (o.noiseM) {
      const xy = proj.toXY(truePt);
      const ang = rand() * 2 * Math.PI;
      const r = rand() * o.noiseM;
      pt = proj.fromXY({ x: xy.x + r * Math.cos(ang), y: xy.y + r * Math.sin(ang) });
    }
    if (o.jumpAt?.includes(i)) {
      const xy = proj.toXY(truePt);
      pt = proj.fromXY({ x: xy.x + (o.jumpM ?? 400), y: xy.y + (o.jumpM ?? 400) / 2 });
    }
    const dropped = (o.dropRanges ?? []).some(([a, b]) => s >= a && s <= b);
    out.push({
      fix: {
        lat: pt.lat,
        lon: pt.lon,
        timestamp: t,
        speed: v,
        accuracy: o.accuracy ?? 5,
        heading: v > 0.5 ? route.bearingAt(Math.min(s, total - 0.01)) : null,
      },
      s,
      t,
      dropped,
    });
    s += (v * dt) / 1000;
    t += dt;
    i++;
  }
  return out;
}

export const fixes = (samples: DriveSample[]) => samples.filter((x) => !x.dropped).map((x) => x.fix);

/** A szakasz elejére (s0) és végére (s1) eső valódi időpont interpolálva. */
export function trueTimeAt(samples: DriveSample[], s: number): number {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (b.s >= s) return a.t + ((s - a.s) / (b.s - a.s)) * (b.t - a.t);
  }
  throw new Error('s kívül esik');
}

export const reverseXY = (pts: XY[]) => [...pts].reverse();
export { bearingDeg };
