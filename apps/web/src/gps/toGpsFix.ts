import type { GpsFix } from '@atlagsebesseg/core';

const finite = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v);

/** A böngésző GeolocationPosition-je → `GpsFix` (Safari állva NaN irányt ad; negatív sebesség = ismeretlen). */
export function toGpsFix(p: Pick<GeolocationPosition, 'coords' | 'timestamp'>): GpsFix {
  const { latitude, longitude, speed, heading, accuracy } = p.coords;
  const s = finite(speed);
  const h = finite(heading);
  return {
    lat: latitude,
    lon: longitude,
    timestamp: p.timestamp,
    speed: s !== null && s >= 0 ? s : null,
    accuracy: finite(accuracy),
    heading: h !== null && h >= 0 ? h % 360 : null,
  };
}
