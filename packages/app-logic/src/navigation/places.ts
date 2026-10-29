import { haversineM } from '@atlagsebesseg/core';
import { t } from '../i18n';
import { NAV_CONFIG } from './config';
import type { Place } from './types';

export const RECENTS_KEY = 'nav:recents:v1';
export const SAVED_KEY = 'nav:saved:v1';

export interface SavedPlaces {
  home: Place | null;
  work: Place | null;
  /** További mentett címek (a Haza / Munka mellett), a mentés sorrendjében. */
  others: Place[];
}

export const NO_SAVED: SavedPlaces = { home: null, work: null, others: [] };

/** Legfeljebb ennyi további mentett cím. */
export const SAVED_OTHERS_MAX = 10;

const isPlace = (p: unknown): p is Place => {
  const x = p as Place | null;
  return !!x && typeof x.name === 'string' && typeof x.lat === 'number' && typeof x.lon === 'number' && Number.isFinite(x.lat) && Number.isFinite(x.lon);
};

const isLatLon = (v: unknown): v is { lat: number; lon: number } => {
  const x = v as { lat?: unknown; lon?: unknown } | null;
  return !!x && typeof x.lat === 'number' && typeof x.lon === 'number' && Number.isFinite(x.lat) && Number.isFinite(x.lon);
};

const clean = (p: Place): Place => {
  const base = { id: String(p.id ?? `${p.lat},${p.lon}`), name: p.name, address: typeof p.address === 'string' ? p.address : '', lat: p.lat, lon: p.lon };
  return isLatLon(p.routable) ? { ...base, routable: { lat: p.routable.lat, lon: p.routable.lon } } : base;
};

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
    const v = JSON.parse(raw ?? 'null') as { home?: unknown; work?: unknown; others?: unknown } | null;
    return {
      home: isPlace(v?.home) ? clean(v.home) : null,
      work: isPlace(v?.work) ? clean(v.work) : null,
      others: Array.isArray(v?.others) ? v.others.filter(isPlace).map(clean).slice(0, SAVED_OTHERS_MAX) : [],
    };
  } catch {
    return NO_SAVED;
  }
}

/** Új további mentett cím a lista végére; ugyanaz a hely (azonos azonosító vagy 100 m-en belül) nem duplázódik. */
export function addSavedOther(saved: SavedPlaces, place: Place): SavedPlaces {
  const p = clean(place);
  if (saved.others.some((x) => x.id === p.id || haversineM(x, p) <= 100)) return saved;
  return { ...saved, others: [...saved.others, p].slice(0, SAVED_OTHERS_MAX) };
}

export const removeSavedOther = (saved: SavedPlaces, id: string): SavedPlaces => ({ ...saved, others: saved.others.filter((x) => x.id !== id) });

/** A kereső chip-sora: Haza, Munka (ha be vannak állítva), majd a további mentett címek a nevükkel. */
export function savedChips(saved: SavedPlaces): { key: string; icon: 'home' | 'work' | 'pin'; label: string; place: Place }[] {
  return [
    ...(saved.home ? [{ key: 'home', icon: 'home' as const, label: t('nav.place.home'), place: saved.home }] : []),
    ...(saved.work ? [{ key: 'work', icon: 'work' as const, label: t('nav.place.work'), place: saved.work }] : []),
    ...saved.others.map((p) => ({ key: `other:${p.id}`, icon: 'pin' as const, label: p.name, place: p })),
  ];
}
