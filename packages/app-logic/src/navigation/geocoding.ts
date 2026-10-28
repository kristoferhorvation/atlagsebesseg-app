import { NAV_CONFIG, NAV_COUNTRIES } from './config';
import { directionsLanguage, type Lang } from '../i18n';
import type { Place } from './types';
import type { LatLon } from '@atlagsebesseg/core';

const BASE = 'https://api.mapbox.com/search/geocode/v6/forward';

/** Mapbox Geocoding (v6, előre-keresés, automatikus kiegészítés) a támogatott országokra. */
export function geocodeUrl(query: string, lang: Lang, token: string, near?: LatLon | null): string {
  const q = new URLSearchParams({
    q: query.trim(),
    country: NAV_COUNTRIES.join(','),
    language: directionsLanguage(lang),
    autocomplete: 'true',
    limit: '6',
  });
  if (near) q.set('proximity', `${near.lon.toFixed(5)},${near.lat.toFixed(5)}`);
  q.set('access_token', token);
  return `${BASE}?${q}`;
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null;

/** A Geocoding-válasz találatai; hibás elemet kihagy. */
export function parseGeocode(json: unknown): Place[] {
  if (!isObj(json) || !Array.isArray(json.features)) return [];
  return json.features.flatMap((f): Place[] => {
    if (!isObj(f) || !isObj(f.geometry) || !Array.isArray(f.geometry.coordinates)) return [];
    const [lon, lat] = f.geometry.coordinates as unknown[];
    if (typeof lon !== 'number' || typeof lat !== 'number') return [];
    const p = isObj(f.properties) ? f.properties : {};
    const name = String(p.name_preferred ?? p.name ?? '').trim();
    if (!name) return [];
    const address = String(p.place_formatted ?? p.full_address ?? '').trim();
    const id = String(p.mapbox_id ?? f.id ?? `${lat},${lon}`);
    return [{ id, name, address, lat, lon }];
  });
}

/** Keresni csak elég hosszú szövegre érdemes (költségvédelem). */
export const shouldSearch = (q: string, min = NAV_CONFIG.geocodeMinChars): boolean => q.trim().length >= min;

export type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; places: Place[] } | { status: 'error' };

export interface SearchDeps {
  search: (query: string) => Promise<Place[]>;
  onState: (s: SearchState) => void;
  debounceMs?: number;
  minChars?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * Keresés gépelés közben: 3 karaktertől, 300 ms-os késleltetéssel; a régi (lassabban érkező)
 * válasz nem írja felül az újabbat.
 */
export class SearchController {
  private timer: unknown = null;
  private seq = 0;

  constructor(private readonly deps: SearchDeps) {}

  input(query: string): void {
    const d = this.deps;
    (d.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = null;
    const seq = ++this.seq;
    if (!shouldSearch(query, d.minChars)) {
      d.onState({ status: 'idle' });
      return;
    }
    this.timer = (d.setTimer ?? setTimeout)(() => {
      this.timer = null;
      d.onState({ status: 'loading' });
      d.search(query.trim()).then(
        (places) => seq === this.seq && d.onState({ status: 'ok', places }),
        () => seq === this.seq && d.onState({ status: 'error' }),
      );
    }, d.debounceMs ?? NAV_CONFIG.geocodeDebounceMs);
  }

  dispose(): void {
    this.seq++;
    (this.deps.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = null;
  }
}
