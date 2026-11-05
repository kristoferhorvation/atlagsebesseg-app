import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchHeatSegments,
  globalLines,
  heatQueryBox,
  heatQueryKey,
  heatSeedTrackLines,
  HeatGlobalCache,
  seedGlobalRows,
  TrackIndex,
  type BBox,
  type HeatLine,
  type HeatMode,
  type HeatView,
  type HeatZone,
  type SegmentGlobalRow,
  type TrackLine,
} from '@atlagsebesseg/app-logic';
import { supabase } from '../backend';
import { clearSegmentOutbox, flushSegmentOutbox } from '../heat/heatShare';
import { catchUpTracks } from '../heat/trackPipeline';
import { listTracks } from '../trips/tripStore';

/** `?heatSeed` – mesterséges, több utas adat a szimulátorban (a nav-shots ellenőrzi vele a réteget). */
export const HEAT_SEED = new URLSearchParams(location.search).has('heatSeed');

export interface HeatLayer {
  lines: readonly HeatLine[];
  view: HeatView;
}

export interface HeatViewport {
  bbox: BBox;
  zoom: number;
}

/**
 * AW24: a hőtérkép adata a térképnek, utcákra illesztett csíkokkal. Saját mód: az utak vonalai (IndexedDB `tracks`) a `TrackIndex`-ben, szakaszonként összesítve; közösségi mód:
 * a `heat_segments_global` a látható területre (10 perces gyorsítótár). A megosztás kikapcsolásakor a feltöltési sor törlődik.
 */
export function useHeat(opts: { mode: HeatMode; view: HeatView; share: boolean; version: number; viewport: HeatViewport | null; visible: boolean; zones: readonly HeatZone[] }): HeatLayer | null {
  const { mode, view, share, version, viewport, visible, zones } = opts;
  const [own, setOwn] = useState<readonly (readonly TrackLine[])[]>([]);
  const [seed, setSeed] = useState<TrackLine[][] | null>(null);
  const [globalRows, setGlobalRows] = useState<readonly SegmentGlobalRow[] | null>(null);
  const need = mode !== 'ki';

  useEffect(() => {
    if (!need || !HEAT_SEED) return;
    void import('../../../../packages/app-logic/src/fixtures/heat-seed-routes.json').then((m) => setSeed(heatSeedTrackLines(m.default.routes)));
  }, [need]);

  // a saját vonalak: induláskor a függő és a régi utak feldolgozása, utána minden út végén újratöltés
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const shareRef = useRef(share);
  shareRef.current = share;
  const [caughtUp, setCaughtUp] = useState(0);
  useEffect(() => {
    if (!need || HEAT_SEED) return;
    void catchUpTracks({ share: () => shareRef.current, zones: () => zonesRef.current })
      .then((changed) => changed && setCaughtUp((v) => v + 1))
      .catch((e: unknown) => console.warn('[heat] catch-up failed', e));
  }, [need, version]);
  useEffect(() => {
    if (!need || HEAT_SEED) return;
    let cancelled = false;
    void listTracks()
      .then((t) => !cancelled && setOwn(t.filter((x) => x.status === 'done').map((x) => x.lines)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [need, version, caughtUp]);

  const index = useMemo(() => {
    const i = new TrackIndex();
    for (const l of seed ?? own) i.add(l);
    return i;
  }, [own, seed]);

  // közösségi mód: lekérés a látható területre, 10 perc gyorsítótár
  const cache = useMemo(() => new HeatGlobalCache<SegmentGlobalRow>(() => Date.now()), []);
  useEffect(() => {
    if (mode !== 'kozossegi' || !viewport || !visible) return;
    if (HEAT_SEED) {
      if (seed) setGlobalRows(seedGlobalRows(seed));
      return;
    }
    if (!supabase) return;
    const box = heatQueryBox(viewport.bbox);
    const key = heatQueryKey(box, 0);
    const hit = cache.get(key);
    if (hit) {
      setGlobalRows(hit);
      return;
    }
    let cancelled = false;
    fetchHeatSegments(supabase, box)
      .then((rows) => {
        cache.set(key, rows);
        if (!cancelled) setGlobalRows(rows);
      })
      .catch((e: unknown) => console.warn('[heat] fetch failed', e));
    return () => {
      cancelled = true;
    };
  }, [mode, viewport, visible, cache, seed]);

  // megosztás: kikapcsolva a várakozó sorok törlődnek; bekapcsolva induláskor próbáljuk a maradékot feltölteni
  useEffect(() => {
    if (!share) clearSegmentOutbox();
    else void flushSegmentOutbox(supabase);
  }, [share, version]);

  return useMemo(() => {
    if (!visible || mode === 'ki' || !viewport) return null;
    if (mode === 'sajat') {
      if (HEAT_SEED && !seed) return null;
      return { lines: index.lines(viewport, view, zones), view };
    }
    if (!globalRows) return null;
    return { lines: globalLines(globalRows, view), view };
  }, [visible, mode, view, viewport, index, globalRows, seed, zones]);
}
