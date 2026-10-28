import { meterState, type MeterState, type Section } from '@atlagsebesseg/core';
import { formatNumber, t, type TKey } from './i18n';
import type { SpeedUnit } from './settings';

/** A mérőkártya állapota: jó / lassíts / túl gyors (DESIGN.md; a logika a core `meterState`-je). */
export type SpeedStatus = MeterState;

/**
 * Az állapot az átlagból és a várható végső átlagból; befejezve mindkettő a végső átlag.
 * Átlag nélkül `null`.
 */
export function speedStatus(averageKmh: number | null, projectedKmh: number | null, limitKmh: number): SpeedStatus | null {
  return meterState({ averageKmh, projectedKmh, speedLimitKmh: limitKmh });
}

export const KMH_PER_MPH = 1.609344;

/** km/h → a választott egységre, egészre kerekítve (`null` marad `null`). */
export function speedIn(kmh: number | null | undefined, unit: SpeedUnit): number | null {
  if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return null;
  return Math.round(unit === 'mph' ? kmh / KMH_PER_MPH : kmh);
}

/** Mint a `speedIn`, de lefelé kerekítve (a tűrés-kijelzés ne ígérjön többet a valóságosnál). */
export function speedFloorIn(kmh: number | null | undefined, unit: SpeedUnit): number | null {
  if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return null;
  return Math.floor(unit === 'mph' ? kmh / KMH_PER_MPH : kmh);
}

export const unitLabel = (unit: SpeedUnit) => (unit === 'mph' ? 'mph' : 'km/h');

/** Egy tizedesjegy, a nyelv tizedesjelével („12,3” / „12.3”). */
const decimal1 = (x: number) => formatNumber(x, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });

/** Távolság: 1 km alatt 10 m-re kerekítve, felette egy tizedessel (mph-nál mérföldben). */
export function formatDistance(m: number, unit: SpeedUnit): { value: string; unit: string } {
  if (unit === 'mph') {
    const mi = m / 1609.344;
    return mi < 0.2 ? { value: String(Math.round((m * 3.28084) / 50) * 50), unit: 'ft' } : { value: decimal1(mi), unit: 'mi' };
  }
  if (m < 1000) return { value: String(Math.max(0, Math.round(m / 10) * 10)), unit: 'm' };
  return { value: decimal1(m / 1000), unit: 'km' };
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

/** „most”, „12 perce”, „2 órája” – mikor jelentették. */
export function timeAgo(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.minutes', { n: min });
  return t('time.hours', { n: Math.floor(min / 60) });
}

/** „Forrás: Polizia di Stato, 2026-08” – a szakasz-kártyára. */
export function sectionSourceLabel(s: Pick<Section, 'source' | 'provenance'>): string {
  if (s.provenance) return t('source.named', { name: s.provenance.name, date: s.provenance.date });
  return t({ osm: 'source.osm', hivatalos: 'source.official', kozosseg: 'source.community' }[s.source] as TKey);
}
