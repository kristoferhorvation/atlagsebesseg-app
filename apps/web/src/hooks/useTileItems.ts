import { useEffect, useRef, useState } from 'react';
import { tileKey, type TileCache } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';

/**
 * Egy csempézett réteg (kamerák, tervezett mérések) a pozíció környékén: a tartalék lista (pl. a
 * beépített kamerák) + a szerverről csempénként lekért, cache-elt elemek; csempeváltáskor újratölt.
 * `cache = null`: nincs szerver (vagy szimulátor) – csak a tartalék.
 */
export function useTileItems<T extends { id: string }>(cache: TileCache<T> | null, lastFix: GpsFix | null, fallback: readonly T[]): readonly T[] {
  const [items, setItems] = useState<readonly T[]>(fallback);
  const loadedTile = useRef<string | null>(null);
  const tile = lastFix ? tileKey(lastFix.lat, lastFix.lon) : null;

  useEffect(() => setItems(fallback), [fallback]);

  useEffect(() => {
    if (!cache || !lastFix || !tile || tile === loadedTile.current) return;
    loadedTile.current = tile;
    let cancelled = false;
    cache
      .loadItems(lastFix.lat, lastFix.lon)
      .then((r) => {
        if (cancelled) return;
        const byId = new Map<string, T>();
        for (const x of fallback) byId.set(x.id, x);
        for (const x of r.items) byId.set(x.id, x);
        setItems([...byId.values()]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // csak csempeváltáskor
  }, [tile, cache]);

  return items;
}
