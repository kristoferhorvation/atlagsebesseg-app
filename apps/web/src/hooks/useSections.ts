import { useEffect, useRef, useState } from 'react';
import { mergeById, tileKey } from '@atlagsebesseg/app-logic';
import { BUNDLED_SECTIONS } from '@atlagsebesseg/app-logic/bundled-sections';
import type { GpsFix, Section } from '@atlagsebesseg/core';
import { sectionCache, supabase } from '../backend';

export type SectionsStatus = 'beepitett' | 'betoltes' | 'szerver' | 'offline_cache' | 'offline';

/**
 * A környék szakaszai: a beépített lista (fallback) + a szerverről csempénként lekért, cache-elt
 * szakaszok. Csempeváltáskor újratölt; a futó mérést a frissítés nem szakítja meg.
 */
export function useSections(lastFix: GpsFix | null) {
  const [sections, setSections] = useState<readonly Section[]>(BUNDLED_SECTIONS);
  const [status, setStatus] = useState<SectionsStatus>('beepitett');
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
        setStatus(r.fromCache === 0 && r.fromNetwork === 0 ? 'offline' : r.stale ? 'offline_cache' : 'szerver');
      })
      .catch(() => !cancelled && setStatus('offline'));
    return () => {
      cancelled = true;
    };
    // csak csempeváltáskor
  }, [tile]);

  return { sections, status };
}
