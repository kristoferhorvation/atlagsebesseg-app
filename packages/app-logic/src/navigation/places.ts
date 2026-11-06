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

/**
 * AW25 (INV-25, Mapbox-feltételek): tartósan (helyi tár, fiók-szinkron) a keresési találatból csak a koordináta (+ az útra illesztett
 * pont) és a felhasználó saját címkéje kerül; a Mapbox-név és -cím nem. A nevet megjelenítéskor a memóriából (`placeNames`, a futás alatt
 * látott találat) vagy újra lekérve (`reverseGeocodeUrl`) adjuk.
 */
const clean = (p: Place): Place => {
  const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 40) : undefined;
  const base: Place = { id: String(p.id ?? placeKey(p)), name: '', address: '', lat: p.lat, lon: p.lon, ...(label ? { label } : {}) };
  return isLatLon(p.routable) ? { ...base, routable: { lat: p.routable.lat, lon: p.routable.lon } } : base;
};

/** A hely kulcsa a névtárhoz: a koordináta 5 tizedesre (~1 m). */
export const placeKey = (p: { lat: number; lon: number }): string => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** AW25: a futás alatt látott Mapbox-nevek – csak memóriában (a Mapbox ideiglenes tárolást enged), soha nem a tárba. */
const placeNames = new Map<string, { name: string; address: string }>();

/** Egy találat nevének megjegyzése a futás idejére (választáskor, mentéskor, fordított geokódoláskor). */
export function rememberPlaceName(p: { lat: number; lon: number; name?: string; address?: string }): void {
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (name) placeNames.set(placeKey(p), { name, address: typeof p.address === 'string' ? p.address : '' });
}

/** Megjelenítésre: a saját címke, különben a futás alatt látott / újra lekért név; ha még nincs, a koordináta. */
export function displayPlace(p: Place): Place {
  const known = placeNames.get(placeKey(p));
  if (p.label) return { ...p, name: p.label, address: known ? [known.name, known.address].filter(Boolean).join(', ') : '' };
  if (p.name) return p;
  return known ? { ...p, name: known.name, address: known.address } : { ...p, name: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`, address: '' };
}

/** A helyek, amelyeknek se címkéje, se ismert neve nincs – ezekre megy fordított geokódolás (egyszer helyenként). */
export const placesNeedingNames = (ps: readonly Place[]): Place[] => ps.filter((p) => !p.label && !p.name && !placeNames.has(placeKey(p)));

/** Csak teszthez: a névtár ürítése (egy újraindított app állapota). */
export const forgetPlaceNames = (): void => placeNames.clear();

/** Tárolt utolsó úti célok; sérült érték helyett üres lista. */
export function parseRecents(raw: string | null | undefined, max = NAV_CONFIG.recentMax): Place[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    // a régi (AW25 előtti) tárolt nevek a futás idejére a memóriába kerülnek, a tárba már nem
    return Array.isArray(v) ? v.filter(isPlace).slice(0, max).map((p) => (rememberPlaceName(p), clean(p))) : [];
  } catch {
    return [];
  }
}

/** Új cél a lista elejére; ugyanaz a hely (azonos azonosító vagy 100 m-en belül) nem duplázódik; legfeljebb `max` marad. */
export function addRecent(list: readonly Place[], place: Place, max = NAV_CONFIG.recentMax): Place[] {
  const p = clean(place);
  rememberPlaceName(place);
  const rest = list.filter((x) => x.id !== p.id && haversineM(x, p) > 100);
  return [p, ...rest].slice(0, max);
}

export function parseSaved(raw: string | null | undefined): SavedPlaces {
  try {
    const v = JSON.parse(raw ?? 'null') as { home?: unknown; work?: unknown; others?: unknown } | null;
    return {
      home: isPlace(v?.home) ? (rememberPlaceName(v.home), clean(v.home)) : null,
      work: isPlace(v?.work) ? (rememberPlaceName(v.work), clean(v.work)) : null,
      others: Array.isArray(v?.others) ? v.others.filter(isPlace).slice(0, SAVED_OTHERS_MAX).map((p) => (rememberPlaceName(p), clean(p))) : [],
    };
  } catch {
    return NO_SAVED;
  }
}

/** Új további mentett cím a lista végére; ugyanaz a hely (azonos azonosító vagy 100 m-en belül) nem duplázódik. */
export function addSavedOther(saved: SavedPlaces, place: Place): SavedPlaces {
  const p = clean(place);
  if (saved.others.some((x) => x.id === p.id || haversineM(x, p) <= 100)) return saved;
  rememberPlaceName(place);
  return { ...saved, others: [...saved.others, p].slice(0, SAVED_OTHERS_MAX) };
}

/** AW25: Haza / Munka beállítása vagy törlése – a tárba csak a koordináta és a saját címke kerül (INV-25). */
export function setSavedPlace(saved: SavedPlaces, kind: 'home' | 'work', place: Place | null): SavedPlaces {
  if (place) rememberPlaceName(place);
  return { ...saved, [kind]: place ? clean(place) : null };
}

export const removeSavedOther = (saved: SavedPlaces, id: string): SavedPlaces => ({ ...saved, others: saved.others.filter((x) => x.id !== id) });

/** A kereső chip-sora: Haza, Munka (ha be vannak állítva), majd a további mentett címek a nevükkel. */
export function savedChips(saved: SavedPlaces): { key: string; icon: 'home' | 'work' | 'pin'; label: string; place: Place }[] {
  return [
    ...(saved.home ? [{ key: 'home', icon: 'home' as const, label: t('nav.place.home'), place: saved.home }] : []),
    ...(saved.work ? [{ key: 'work', icon: 'work' as const, label: t('nav.place.work'), place: saved.work }] : []),
    ...saved.others.map((p) => ({ key: `other:${p.id}`, icon: 'pin' as const, label: displayPlace(p).name, place: displayPlace(p) })),
  ];
}
