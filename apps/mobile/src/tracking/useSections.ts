import { useEffect, useRef, useState } from 'react';
import type { GpsFix, Section } from '@atlagsebesseg/core';
import { sectionCache } from '../backend/sectionsRepo';
import { supabase } from '../backend/supabase';
import { BUNDLED_SECTIONS } from '../data/sections';
import { mergeById, tileKey } from '../logic/sectionCache';

export type SectionsStatus = 'csomagolt' | 'betoltes' | 'szerver' | 'offline_cache' | 'offline';

/**
 * A környék szakaszai: az appba csomagolt lista + a szerverről csempénként lekért (és cache-elt)
 * szakaszok. Csempeváltáskor újratölt; hálózat nélkül a cache, végső esetben a csomagolt adat.
 */
export function useSections(lastFix: GpsFix | null) {
  const [sections, setSections] = useState<readonly Section[]>(BUNDLED_SECTIONS);
  const [status, setStatus] = useState<SectionsStatus>('csomagolt');
  const loadedTile = useRef<string | null>(null);
  const tile = lastFix ? tileKey(lastFix.lat, lastFix.lon) : null;

  useEffect(() => {
    if (!supabase || !lastFix || !tile || tile === loadedTile.current) return;
    loadedTile.current = tile;
    let cancelled = false;
    setStatus('betoltes');
    sectionCache
      .load(lastFix.lat, lastFix.lon)
      .then((r) => {
        if (cancelled) return;
        setSections(mergeById(BUNDLED_SECTIONS, r.sections));
        setStatus(r.missing > 0 && r.fromCache === 0 && r.fromNetwork === 0 ? 'offline' : r.stale ? 'offline_cache' : 'szerver');
      })
      .catch(() => !cancelled && setStatus('offline'));
    return () => {
      cancelled = true;
    };
    // csak csempeváltáskor
  }, [tile]);

  return { sections, status };
}
