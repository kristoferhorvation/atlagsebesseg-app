import { formatNumber, t } from '../i18n';

/** A manőver-ikon családja (a platform saját rajzot társít hozzá). */
export type ManeuverIcon =
  | 'straight'
  | 'slight_left'
  | 'left'
  | 'sharp_left'
  | 'slight_right'
  | 'right'
  | 'sharp_right'
  | 'uturn'
  | 'roundabout_left'
  | 'roundabout_right'
  | 'merge'
  | 'fork_left'
  | 'fork_right'
  | 'arrive'
  | 'depart';

/** A Directions `type` + `modifier` párosa → ikon. Ismeretlen kombináció: egyenesen. */
export function maneuverIcon(type: string, modifier: string | null): ManeuverIcon {
  const m = modifier ?? 'straight';
  const left = m.includes('left');
  if (type === 'arrive') return 'arrive';
  if (type === 'depart') return 'depart';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return left ? 'roundabout_left' : 'roundabout_right';
  if (m === 'uturn') return 'uturn';
  if (type === 'merge') return 'merge';
  if (type === 'fork') return left ? 'fork_left' : m.includes('right') ? 'fork_right' : 'straight';
  if (m === 'sharp left') return 'sharp_left';
  if (m === 'sharp right') return 'sharp_right';
  if (m === 'slight left') return 'slight_left';
  if (m === 'slight right') return 'slight_right';
  if (m === 'left') return 'left';
  if (m === 'right') return 'right';
  return 'straight';
}

/** Idő a Directions másodperceiből: „12 perc” / „1 ó 25 perc” (legalább 1 perc). */
export function formatTripDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  return min < 60 ? t('nav.dur.min', { n: min }) : t('nav.dur.hm', { h: Math.floor(min / 60), m: min % 60 });
}

/** Napszak a nyelv szerint („14:32”), a készülék időzónájában. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Egész percek (a „−7 perc” felirathoz). */
export const wholeMinutes = (seconds: number): string => formatNumber(Math.max(1, Math.round(seconds / 60)), { maximumFractionDigits: 0 });
