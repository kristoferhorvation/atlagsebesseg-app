import { bearingDeg, haversineM, LocalProjection } from './geo';
import type { LatLon } from './types';

export interface RouteProjection {
  /**
   * Útvonal menti távolság a kezdőponttól méterben, a névleges hosszra skálázva.
   * A kezdőpont előtt negatív, a végpont után nagyobb a hossznál
   * (az első és az utolsó szakasz meghosszabbításán mérve).
   */
  alongM: number;
  /** Merőleges távolság az útvonaltól méterben (előjel nélkül). */
  crossM: number;
  /** Az útvonal irányszöge a vetített pontban. */
  bearingDeg: number;
}

export interface ProjectionHint {
  /** Csak az ebbe az útvonal menti tartományba eső szakaszokat vizsgálja (méter, skálázott). */
  fromM: number;
  toM: number;
}

interface Segment {
  a: LatLon;
  b: LatLon;
  proj: LocalProjection;
  bx: number;
  by: number;
  len2: number;
  /** Geometriai (haversine) hossz. */
  lengthM: number;
  /** Kumulált geometriai távolság a szakasz elején. */
  startM: number;
  bearing: number;
}

/**
 * Egy szakasz vonala, amire a GPS-pontokat vetítjük.
 * A geometriai hosszt a névleges (hivatalos) hosszra skálázza, így a vetítés
 * a végponton pontosan `lengthM`-et ad.
 */
export class Route {
  readonly geometricLengthM: number;
  readonly lengthM: number;
  private readonly segments: Segment[];
  private readonly scale: number;

  constructor(points: readonly LatLon[], nominalLengthM?: number) {
    const pts = dedupe(points);
    if (pts.length < 2) throw new Error('Route: legalább két különböző pont kell');
    this.segments = [];
    let cum = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const proj = new LocalProjection(a);
      const bxy = proj.toXY(b);
      const lengthM = haversineM(a, b);
      this.segments.push({
        a,
        b,
        proj,
        bx: bxy.x,
        by: bxy.y,
        len2: bxy.x * bxy.x + bxy.y * bxy.y,
        lengthM,
        startM: cum,
        bearing: bearingDeg(a, b),
      });
      cum += lengthM;
    }
    this.geometricLengthM = cum;
    this.lengthM = nominalLengthM && nominalLengthM > 0 ? nominalLengthM : cum;
    this.scale = this.lengthM / cum;
  }

  get start(): LatLon {
    return this.segments[0]!.a;
  }

  get end(): LatLon {
    return this.segments[this.segments.length - 1]!.b;
  }

  /** A pont vetítése a legközelebbi szakaszra (a `hint` tartományon belül, ha van). */
  project(p: LatLon, hint?: ProjectionHint): RouteProjection {
    let best: RouteProjection | null = null;
    const last = this.segments.length - 1;
    for (let pass = 0; pass < 2 && !best; pass++) {
      const useHint = pass === 0 && hint !== undefined;
      if (pass === 1 && !hint) break;
      for (let i = 0; i <= last; i++) {
        const s = this.segments[i]!;
        if (useHint) {
          const from = s.startM * this.scale;
          const to = (s.startM + s.lengthM) * this.scale;
          // Az első/utolsó szakasz meghosszabbítása is a tartományhoz tartozik.
          const lo = i === 0 ? -Infinity : from;
          const hi = i === last ? Infinity : to;
          if (hi < hint!.fromM || lo > hint!.toM) continue;
        }
        const xy = s.proj.toXY(p);
        let t = s.len2 > 0 ? (xy.x * s.bx + xy.y * s.by) / s.len2 : 0;
        if (i > 0) t = Math.max(t, 0);
        if (i < last) t = Math.min(t, 1);
        const dx = xy.x - t * s.bx;
        const dy = xy.y - t * s.by;
        const crossM = Math.hypot(dx, dy);
        if (!best || crossM < best.crossM) {
          best = { alongM: (s.startM + t * s.lengthM) * this.scale, crossM, bearingDeg: s.bearing };
        }
      }
    }
    return best!;
  }

  /** Az útvonal irányszöge adott (skálázott) távolságnál. */
  bearingAt(alongM: number): number {
    return this.segmentAt(alongM).bearing;
  }

  /** Az útvonal pontja adott (skálázott) távolságnál; a végeken túl a meghosszabbításon. */
  pointAt(alongM: number): LatLon {
    const s = this.segmentAt(alongM);
    const t = s.lengthM > 0 ? (alongM / this.scale - s.startM) / s.lengthM : 0;
    return s.proj.fromXY({ x: t * s.bx, y: t * s.by });
  }

  private segmentAt(alongM: number): Segment {
    const g = alongM / this.scale;
    for (const s of this.segments) if (g < s.startM + s.lengthM) return s;
    return this.segments[this.segments.length - 1]!;
  }
}

function dedupe(points: readonly LatLon[]): LatLon[] {
  const out: LatLon[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || haversineM(prev, p) > 0.01) out.push(p);
  }
  return out;
}
