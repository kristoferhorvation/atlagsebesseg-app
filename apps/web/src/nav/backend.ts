import { DirectionsClient, geocodeUrl, getLanguage, parseGeocode, RequestCounter, type Place, type SyncStore } from '@atlagsebesseg/app-logic';
import type { LatLon } from '@atlagsebesseg/core';

/** localStorage szinkron burokban; tiltott tárhelynél csendben üres / nem ment. */
export const syncStore: SyncStore = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // tárhely nélkül csak erre a munkamenetre szól
    }
  },
};

const TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

/** A mai útvonal-kérések számlálója (Beállítások → Állapot). */
export const requestCounter = new RequestCounter(syncStore);

/** Az élő Directions-kliens (költségvédelemmel); token nélkül nincs. */
export const directionsClient = TOKEN
  ? new DirectionsClient({
      token: TOKEN,
      lang: getLanguage,
      counter: requestCounter,
      fetch: (url) => fetch(url),
    })
  : null;

/** Élő keresés a Mapbox Geocoding API-n. */
export async function searchPlaces(query: string, near: LatLon | null): Promise<Place[]> {
  if (!TOKEN) return [];
  const res = await fetch(geocodeUrl(query, getLanguage(), TOKEN, near));
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  return parseGeocode(await res.json());
}
