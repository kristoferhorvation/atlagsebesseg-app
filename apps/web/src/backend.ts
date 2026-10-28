import {
  createSupabaseClient,
  fetchCamerasInBBox,
  fetchPlannedChecksInBBox,
  fetchSectionsInBBox,
  SectionCache,
  TileCache,
  type KeyValueStore,
} from '@atlagsebesseg/app-logic';

/** `null`, ha nincs beállítva (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) – akkor offline mód. */
export const supabase = createSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

/** localStorage aszinkron burokban; privát módban / tiltott tárhelynél csendben üres. */
export const localStore: KeyValueStore = {
  getItem: async (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: async (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // megtelt / tiltott tárhely: cache nélkül megy tovább
    }
  },
};

/** Csempénkénti szakasz-cache (24 óra), offline a lejárt cache is jó. */
export const sectionCache = new SectionCache(localStore, (b) => fetchSectionsInBBox(supabase, b));

/** Fix kamerák csempénként (24 óra; ritkán változnak). */
export const cameraCache = new TileCache(localStore, (b) => fetchCamerasInBBox(supabase, b), { prefix: 'cameras' });

/** Tervezett mérések csempénként – rövid élettartam (3 óra), mert hetente kétszer frissülnek és lejárnak. */
export const plannedCache = new TileCache(localStore, (b) => fetchPlannedChecksInBBox(supabase, b), { prefix: 'planned', ttlMs: 3 * 3600_000 });
