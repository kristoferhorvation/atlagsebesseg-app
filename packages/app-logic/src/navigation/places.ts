import { haversineM } from '@atlagsebesseg/core';
import { NAV_CONFIG } from './config';
import type { Place } from './types';

export const RECENTS_KEY = 'nav:recents:v1';
export const SAVED_KEY = 'nav:saved:v1';

export interface SavedPlaces {
  home: Place | null;
  work: Place | null;
}

export const NO_SAVED: SavedPlaces = { home: null, work: null };

const isPlace = (p: unknown): p is Place => {
  const x = p as Place | null;
  return !!x && typeof x.name === 'string' && typeof x.lat === 'number' && typeof x.lon === 'number' && Number.isFinite(x.lat) && Number.isFinite(x.lon);
};

const clean = (p: Place): Place => ({ id: String(p.id ?? `${p.lat},${p.lon}`), name: p.name, address: typeof p.address === 'string' ? p.address : '', lat: p.lat, lon: p.lon });

/** Tárolt utolsó úti célok; sérült érték helyett üres lista. */
export function parseRecents(raw: string | null | undefined, max = NAV_CONFIG.recentMax): Place[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter(isPlace).map(clean).slice(0, max) : [];
  } catch {
    return [];
  }
}

/** Új cél a lista elejére; ugyanaz a hely (azonos azonosító vagy 100 m-en belül) nem duplázódik; legfeljebb `max` marad. */
export function addRecent(list: readonly Place[], place: Place, max = NAV_CONFIG.recentMax): Place[] {
  const p = clean(place);
  const rest = list.filter((x) => x.id !== p.id && haversineM(x, p) > 100);
  return [p, ...rest].slice(0, max);
}

export function parseSaved(raw: string | null | undefined): SavedPlaces {
  try {
    const v = JSON.parse(raw ?? 'null') as { home?: unknown; work?: unknown } | null;
    return { home: isPlace(v?.home) ? clean(v.home) : null, work: isPlace(v?.work) ? clean(v.work) : null };
  } catch {
    return NO_SAVED;
  }
}
