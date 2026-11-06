import { DirectionsClient, getLanguage, parseGeocode, parseRetrieve, parseSuggest, placesNeedingNames, rememberPlaceName, RequestCounter, retrieveUrl, reverseGeocodeUrl, SearchSession, suggestUrl, type Place, type SyncStore } from '@atlagsebesseg/app-logic';
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

/** AW23: egy nyitott keresés egy Search Box-munkamenet (a token újrahasznosul, választáskor zárul). */
const searchSession = new SearchSession(() => crypto.randomUUID());

/** Élő keresés a Mapbox Search Box API-n (cím, üzlet, étterem, pláza, nevezetesség). */
export async function searchPlaces(query: string, near: LatLon | null): Promise<Place[]> {
  if (!TOKEN) return [];
  const res = await fetch(suggestUrl(query, getLanguage(), TOKEN, searchSession.suggestToken(), near));
  if (!res.ok) throw new Error(`searchbox ${res.status}`);
  return parseSuggest(await res.json(), query);
}

/** A választott találat koordinátája (a mentett és a korábbi helyeknél nincs hívás). */
export async function resolvePlace(hit: Place): Promise<Place> {
  if (!hit.retrieveId) return hit;
  const res = await fetch(retrieveUrl(hit.retrieveId, getLanguage(), TOKEN, searchSession.retrieveToken()));
  if (!res.ok) throw new Error(`searchbox ${res.status}`);
  const place = parseRetrieve(await res.json(), hit);
  if (!place) throw new Error('searchbox: nincs hely');
  return place;
}

/**
 * AW25 (INV-25): a mentett / legutóbbi helyek neve nincs a tárban – a névtelenekre fordított geokódolás, helyenként egyszer a futás alatt,
 * az eredmény csak memóriában (`rememberPlaceName`). Automatizált böngészőben (tesztek) és token nélkül nem hív: ott a koordináta látszik.
 */
const asked = new Set<string>();
export async function resolvePlaceNames(places: readonly Place[]): Promise<boolean> {
  if (!TOKEN || navigator.webdriver) return false;
  const todo = placesNeedingNames(places).filter((p) => !asked.has(p.id)).slice(0, 12);
  let found = false;
  await Promise.all(
    todo.map(async (p) => {
      asked.add(p.id);
      try {
        const res = await fetch(reverseGeocodeUrl(p, getLanguage(), TOKEN));
        const hit = res.ok ? parseGeocode(await res.json())[0] : undefined;
        if (hit) {
          rememberPlaceName({ lat: p.lat, lon: p.lon, name: hit.name, address: hit.address });
          found = true;
        }
      } catch {
        // hálózat nélkül a koordináta marad; a következő indításkor újra próbál
      }
    }),
  );
  return found;
}
