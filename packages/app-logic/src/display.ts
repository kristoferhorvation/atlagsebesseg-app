import type { SpeedUnit } from './settings';

/** A szín-kód: jó / határon / túl (DESIGN.md). */
export type SpeedStatus = 'jo' | 'hataron' | 'tul';

export interface StatusMargin {
  /** A határ ennyi százalékán belül „határon”. */
  percent: number;
  /** … de legalább ennyi km/h-n belül. */
  minKmh: number;
}

export const DEFAULT_STATUS_MARGIN: StatusMargin = { percent: 3, minKmh: 3 };

/**
 * Az átlag és a (szigorú) határ viszonya: a határ felett `tul`, az utolsó 3%-on (min. 3 km/h)
 * belül `hataron`, egyébként `jo`. Átlag nélkül `null`.
 */
export function speedStatus(averageKmh: number | null, limitKmh: number, m: StatusMargin = DEFAULT_STATUS_MARGIN): SpeedStatus | null {
  if (averageKmh === null) return null;
  if (averageKmh > limitKmh) return 'tul';
  const margin = Math.max(m.minKmh, (limitKmh * m.percent) / 100);
  return averageKmh > limitKmh - margin ? 'hataron' : 'jo';
}

export const KMH_PER_MPH = 1.609344;

/** km/h → a választott egységre, egészre kerekítve (`null` marad `null`). */
export function speedIn(kmh: number | null | undefined, unit: SpeedUnit): number | null {
  if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return null;
  return Math.round(unit === 'mph' ? kmh / KMH_PER_MPH : kmh);
}

export const unitLabel = (unit: SpeedUnit) => (unit === 'mph' ? 'mph' : 'km/h');

/** Távolság: 1 km alatt 10 m-re kerekítve, felette egy tizedessel (mph-nál mérföldben). */
export function formatDistance(m: number, unit: SpeedUnit): { value: string; unit: string } {
  if (unit === 'mph') {
    const mi = m / 1609.344;
    return mi < 0.2 ? { value: String(Math.round((m * 3.28084) / 50) * 50), unit: 'ft' } : { value: mi.toFixed(1).replace('.', ','), unit: 'mi' };
  }
  if (m < 1000) return { value: String(Math.max(0, Math.round(m / 10) * 10)), unit: 'm' };
  return { value: (m / 1000).toFixed(1).replace('.', ','), unit: 'km' };
}

/** Eltelt idő „m:ss” vagy „h:mm:ss” alakban. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** Megtett hányad 0…1 között. */
export const progressOf = (doneM: number, lengthM: number) => (lengthM > 0 ? Math.min(1, Math.max(0, doneM / lengthM)) : 0);
