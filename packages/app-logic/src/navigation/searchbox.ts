import type { LatLon } from '@atlagsebesseg/core';
import { directionsLanguage, type Lang } from '../i18n';
import { NAV_COUNTRIES } from './config';
import { displayPlace, type SavedPlaces } from './places';
import type { Place } from './types';

/**
 * AW23: célkeresés a Mapbox Search Box API-n (cím, üzlet, étterem, pláza, nevezetesség): gépelés közben `/suggest`, választáskor
 * `/retrieve`, munkamenet-tokennel. A számlázás munkamenetenként megy: 50 `/suggest` + 1 `/retrieve`, 2 perc tétlenség után lejár.
 * A Geocoding API marad a koordinátából címre (bejelentések, Live Activity).
 */
const BASE = 'https://api.mapbox.com/search/searchbox/v1';

export const SEARCH_SESSION = { maxSuggest: 50, idleMs: 120_000, limit: 10, shown: 6, nearM: 50_000 } as const;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const pair = (p: LatLon) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;

export function suggestUrl(query: string, lang: Lang, token: string, sessionToken: string, near?: LatLon | null): string {
  const q = new URLSearchParams({
    q: query.trim(),
    language: directionsLanguage(lang),
    limit: String(SEARCH_SESSION.limit),
    country: NAV_COUNTRIES.join(',').toLowerCase(),
    session_token: sessionToken,
  });
  // a közeli találatok előre, a távolság innen számol
  if (near) {
    q.set('proximity', pair(near));
    q.set('origin', pair(near));
  }
  q.set('access_token', token);
  return `${BASE}/suggest?${q}`;
}

export function retrieveUrl(id: string, lang: Lang, token: string, sessionToken: string): string {
  const q = new URLSearchParams({ language: directionsLanguage(lang), session_token: sessionToken, access_token: token });
  return `${BASE}/retrieve/${encodeURIComponent(id)}?${q}`;
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null;
/** Ezek nem egy helyre mutatnak (kategória, márka): a találatsorban nincs helyük. */
const NOT_A_PLACE = ['category', 'brand', 'list', 'query'];

/** Település, régió: a távolság itt nem számít (Győr Budapestről is az első). */
const AREA_TYPES = ['place', 'region', 'locality', 'district', 'neighborhood', 'postcode', 'country'];

/**
 * A `/suggest` találatai (koordináta még nincs bennük, a `retrieveId`-vel kérjük le választáskor). A közeli találatok előre (a Mapbox egy 190 km-re
 * lévő, pontos nevű utcát is elsőnek ad): elöl a település és a pontos nevű közeli hely, utána a többi `nearM`-en belül, végül a távoliak; ezeken
 * belül a Mapbox sorrendje marad.
 */
export function parseSuggest(json: unknown, query = ''): Place[] {
  if (!isObj(json) || !Array.isArray(json.suggestions)) return [];
  const q = fold(query.trim());
  const rank = (p: Place, type: unknown): number => {
    if (AREA_TYPES.includes(String(type))) return 0;
    const near = p.distanceM === undefined || p.distanceM <= SEARCH_SESSION.nearM;
    if (!near) return 2;
    return fold(p.name) === q ? 0 : 1;
  };
  const ranked = json.suggestions.flatMap((s): { p: Place; r: number }[] => {
    if (!isObj(s) || typeof s.mapbox_id !== 'string' || NOT_A_PLACE.includes(String(s.feature_type))) return [];
    const name = String(s.name_preferred ?? s.name ?? '').trim();
    if (!name) return [];
    // rövid cím: a név után a pontos cím (üzletnél), különben a tágabb hely
    const street = typeof s.address === 'string' ? s.address.trim() : '';
    const place = String(s.place_formatted ?? '').trim();
    const address = street && street !== name ? `${street}, ${place.split(',')[0]?.trim() ?? ''}`.replace(/, $/, '') : place;
    const base: Place = { id: s.mapbox_id, name, address, lat: 0, lon: 0, retrieveId: s.mapbox_id };
    const hit = typeof s.distance === 'number' && Number.isFinite(s.distance) ? { ...base, distanceM: s.distance } : base;
    return [{ p: hit, r: rank(hit, s.feature_type) }];
  });
  return ranked
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, SEARCH_SESSION.shown)
    .map((x) => x.p);
}

/** A `/retrieve` válaszából a választott hely, koordinátával és (ha van) az útra eső ponttal; `null`, ha nincs benne hely. */
export function parseRetrieve(json: unknown, hit: Pick<Place, 'id' | 'name' | 'address'>): Place | null {
  if (!isObj(json) || !Array.isArray(json.features)) return null;
  const f = json.features[0];
  if (!isObj(f) || !isObj(f.geometry) || !Array.isArray(f.geometry.coordinates)) return null;
  const [lon, lat] = f.geometry.coordinates as unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  const p = isObj(f.properties) ? f.properties : {};
  const rp = isObj(p.coordinates) && Array.isArray(p.coordinates.routable_points) ? p.coordinates.routable_points[0] : null;
  const routable = isObj(rp) && typeof rp.latitude === 'number' && typeof rp.longitude === 'number' ? { lat: rp.latitude, lon: rp.longitude } : null;
  const base: Place = { id: hit.id, name: hit.name, address: hit.address, lat, lon };
  return routable ? { ...base, routable } : base;
}

/**
 * A munkamenet-token: egy keresésen belül ugyanaz; új jön `retrieve` után, `maxSuggest` hívás után és `idleMs` tétlenség után
 * (így egy megnyitott kereső egy számlázott munkamenet).
 */
export class SearchSession {
  private current: string | null = null;
  private count = 0;
  private lastAt = 0;

  constructor(
    private readonly newToken: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  /** A következő `/suggest` tokenje. */
  suggestToken(): string {
    const t = this.now();
    if (!this.current || this.count >= SEARCH_SESSION.maxSuggest || t - this.lastAt > SEARCH_SESSION.idleMs) {
      this.current = this.newToken();
      this.count = 0;
    }
    this.count++;
    this.lastAt = t;
    return this.current;
  }

  /** A `/retrieve` tokenje: lezárja a munkamenetet. */
  retrieveToken(): string {
    const token = this.current ?? this.newToken();
    this.current = null;
    return token;
  }
}


/** A mentett helyek és az utolsó úti célok közül a gépelt szöveggel egyezők (API-hívás nélkül, a találatok fölött). */
export function localMatches(query: string, saved: SavedPlaces, recents: readonly Place[], max = 4): Place[] {
  const q = fold(query.trim());
  if (!q) return [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const raw of [saved.home, saved.work, ...saved.others, ...recents]) {
    if (!raw || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const p = displayPlace(raw); // AW25: a tárolt helyen nincs Mapbox-név; a futás alatt ismert / újra lekért névvel egyezik
    if (fold(p.name).includes(q) || fold(p.address).includes(q)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
