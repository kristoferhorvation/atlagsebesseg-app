import type { Section } from '@atlagsebesseg/core';

/** Tiszta logika (React Native nélkül) – vitesttel tesztelve. */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Csempeméret fokban (≈ 55 × 40 km Közép-Európában). */
export const TILE_DEG = 0.5;

export const tileKey = (lat: number, lon: number) => `${Math.floor(lat / TILE_DEG)}:${Math.floor(lon / TILE_DEG)}`;

export function tileBBox(key: string): BBox {
  const [y, x] = key.split(':').map(Number) as [number, number];
  return { south: y * TILE_DEG, west: x * TILE_DEG, north: (y + 1) * TILE_DEG, east: (x + 1) * TILE_DEG };
}

/** A ponttal szomszédos csempék (alapból 3 × 3). */
export function tilesAround(lat: number, lon: number, radius = 1): string[] {
  const y0 = Math.floor(lat / TILE_DEG);
  const x0 = Math.floor(lon / TILE_DEG);
  const out: string[] = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) out.push(`${y0 + dy}:${x0 + dx}`);
  return out;
}

interface CachedTile {
  fetchedAt: number;
  sections: Section[];
}

export interface LoadResult {
  sections: Section[];
  fromNetwork: number;
  fromCache: number;
  /** Csempék, amelyekhez se hálózat, se cache nem volt. */
  missing: number;
  /** Igaz, ha legalább egy csempe csak lejárt cache-ből jött (offline). */
  stale: boolean;
}

export interface SectionCacheOptions {
  ttlMs?: number;
  now?: () => number;
  radius?: number;
}

/**
 * Szakaszok csempénként: friss cache → hálózat → (hiba esetén) lejárt cache.
 * Offline is működik, amíg van cache; az appba csomagolt adat a végső tartalék (a hívónál).
 */
export class SectionCache {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly radius: number;

  constructor(
    private readonly store: KeyValueStore,
    private readonly fetchBBox: (bbox: BBox) => Promise<Section[]>,
    opts: SectionCacheOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 24 * 3600_000;
    this.now = opts.now ?? Date.now;
    this.radius = opts.radius ?? 1;
  }

  async load(lat: number, lon: number): Promise<LoadResult> {
    const byId = new Map<string, Section>();
    const res: LoadResult = { sections: [], fromNetwork: 0, fromCache: 0, missing: 0, stale: false };
    await Promise.all(
      tilesAround(lat, lon, this.radius).map(async (key) => {
        const storeKey = `sections:tile:${key}`;
        const cached = await this.read(storeKey);
        let sections: Section[] | null = null;
        if (cached && this.now() - cached.fetchedAt < this.ttlMs) {
          sections = cached.sections;
          res.fromCache++;
        } else {
          try {
            sections = await this.fetchBBox(tileBBox(key));
            res.fromNetwork++;
            await this.store.setItem(storeKey, JSON.stringify({ fetchedAt: this.now(), sections } satisfies CachedTile));
          } catch {
            if (cached) {
              sections = cached.sections;
              res.fromCache++;
              res.stale = true;
            } else {
              res.missing++;
            }
          }
        }
        for (const s of sections ?? []) byId.set(s.id, s);
      }),
    );
    res.sections = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    return res;
  }

  private async read(key: string): Promise<CachedTile | null> {
    try {
      const raw = await this.store.getItem(key);
      return raw ? (JSON.parse(raw) as CachedTile) : null;
    } catch {
      return null;
    }
  }
}

/** Összefésülés azonosító szerint; a későbbi lista nyer (pl. szerver > csomagolt). */
export function mergeById(...lists: readonly (readonly Section[])[]): Section[] {
  const byId = new Map<string, Section>();
  for (const list of lists) for (const s of list) byId.set(s.id, s);
  return [...byId.values()];
}
