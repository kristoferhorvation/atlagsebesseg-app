import type { LatLon } from './types';

export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Nagykör-távolság méterben. */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kezdeti irányszög a-ból b-be, fokban [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dλ = toRad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Két irányszög abszolút különbsége, [0, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

export interface XY {
  x: number;
  y: number;
}

/**
 * Helyi, ekvirektanguláris vetület egy origó körül (x = kelet, y = észak, méterben).
 * Néhány tíz km-en belül a hossztorzulás elhanyagolható (< 0,1%).
 */
export class LocalProjection {
  private readonly cosLat: number;

  constructor(readonly origin: LatLon) {
    this.cosLat = Math.cos(toRad(origin.lat));
  }

  toXY(p: LatLon): XY {
    return {
      x: toRad(p.lon - this.origin.lon) * EARTH_RADIUS_M * this.cosLat,
      y: toRad(p.lat - this.origin.lat) * EARTH_RADIUS_M,
    };
  }

  fromXY(p: XY): LatLon {
    return {
      lat: this.origin.lat + toDeg(p.y / EARTH_RADIUS_M),
      lon: this.origin.lon + toDeg(p.x / (EARTH_RADIUS_M * this.cosLat)),
    };
  }
}

/** Polyline hossza méterben (haversine-összeg). */
export function polylineLengthM(points: readonly LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversineM(points[i - 1]!, points[i]!);
  return sum;
}
