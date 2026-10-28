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

interface CachedTile<T> {
  fetchedAt: number;
  /** A régi (A3–A6) szakasz-cache mezőneve; az új rétegek `items`-ben tárolnak. */
  sections?: T[];
  items?: T[];
}

export interface TileLoad<T> {
  items: T[];
  fromNetwork: number;
  fromCache: number;
  /** Csempék, amelyekhez se hálózat, se cache nem volt. */
  missing: number;
  /** Igaz, ha legalább egy csempe csak lejárt cache-ből jött (offline). */
  stale: boolean;
}

export interface LoadResult extends Omit<TileLoad<Section>, 'items'> {
  sections: Section[];
}

export interface SectionCacheOptions {
  ttlMs?: number;
  now?: () => number;
  radius?: number;
}

export interface TileCacheOptions extends SectionCacheOptions {
  /** A tár kulcsának előtagja (`<prefix>:tile:<csempe>`). */
  prefix: string;
}

/**
 * Bármely azonosítós réteg (szakaszok, kamerák, tervezett mérések) csempénként: friss cache →
 * hálózat → (hiba esetén) lejárt cache. Offline is működik, amíg van cache.
 */
export class TileCache<T extends { id: string }> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly radius: number;
  private readonly prefix: string;

  constructor(
    private readonly store: KeyValueStore,
    private readonly fetchBBox: (bbox: BBox) => Promise<T[]>,
    opts: TileCacheOptions,
  ) {
    this.ttlMs = opts.ttlMs ?? 24 * 3600_000;
    this.now = opts.now ?? Date.now;
    this.radius = opts.radius ?? 1;
    this.prefix = opts.prefix;
  }

  async loadItems(lat: number, lon: number): Promise<TileLoad<T>> {
    const byId = new Map<string, T>();
    const res: TileLoad<T> = { items: [], fromNetwork: 0, fromCache: 0, missing: 0, stale: false };
    await Promise.all(
      tilesAround(lat, lon, this.radius).map(async (key) => {
        const storeKey = `${this.prefix}:tile:${key}`;
        const cached = await this.read(storeKey);
        let items: T[] | null = null;
        if (cached && this.now() - cached.fetchedAt < this.ttlMs) {
          items = cached.items;
          res.fromCache++;
        } else {
          try {
            items = await this.fetchBBox(tileBBox(key));
            res.fromNetwork++;
            const tile: CachedTile<T> = this.prefix === 'sections' ? { fetchedAt: this.now(), sections: items } : { fetchedAt: this.now(), items };
            await this.store.setItem(storeKey, JSON.stringify(tile));
          } catch {
            if (cached) {
              items = cached.items;
              res.fromCache++;
              res.stale = true;
            } else {
              res.missing++;
            }
          }
        }
        for (const s of items ?? []) byId.set(s.id, s);
      }),
    );
    res.items = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    return res;
  }

  private async read(key: string): Promise<{ fetchedAt: number; items: T[] } | null> {
    try {
      const raw = await this.store.getItem(key);
      if (!raw) return null;
      const t = JSON.parse(raw) as CachedTile<T>;
      return { fetchedAt: t.fetchedAt, items: t.items ?? t.sections ?? [] };
    } catch {
      return null;
    }
  }
}

/**
 * Szakaszok csempénként (a `TileCache` a „sections” előtaggal). Offline is működik, amíg van
 * cache; az appba csomagolt adat a végső tartalék (a hívónál).
 */
export class SectionCache extends TileCache<Section> {
  constructor(store: KeyValueStore, fetchBBox: (bbox: BBox) => Promise<Section[]>, opts: SectionCacheOptions = {}) {
    super(store, fetchBBox, { ...opts, prefix: 'sections' });
  }

  async load(lat: number, lon: number): Promise<LoadResult> {
    const { items, ...rest } = await this.loadItems(lat, lon);
    return { ...rest, sections: items };
  }
}

/** Összefésülés azonosító szerint; a későbbi lista nyer (pl. szerver > csomagolt). */
export function mergeById(...lists: readonly (readonly Section[])[]): Section[] {
  const byId = new Map<string, Section>();
  for (const list of lists) for (const s of list) byId.set(s.id, s);
  return [...byId.values()];
}
