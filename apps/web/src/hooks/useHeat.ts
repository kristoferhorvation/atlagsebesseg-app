import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchHeatGlobal,
  globalPoints,
  HEAT,
  heatQueryBox,
  heatQueryKey,
  heatResForZoom,
  HeatGlobalCache,
  HeatIndex,
  heatSeedCells,
  heatSeedGlobal,
  type BBox,
  type HeatCell,
  type HeatGlobalRow,
  type HeatMode,
  type HeatZone,
  type HeatPoint,
  type HeatView,
} from '@atlagsebesseg/app-logic';
import { supabase } from '../backend';
import { clearHeatOutbox, flushHeatOutbox } from '../heat/heatShare';
import { heatGeo, type WebHeatGeo } from '../heat/heatGeo';
import { backfillHeat, listHeat } from '../trips/tripStore';

/** `?heatSeed` – mesterséges, több utas adat a szimulátorban (a nav-shots ellenőrzi vele a réteget). */
export const HEAT_SEED = new URLSearchParams(location.search).has('heatSeed');

export interface HeatLayer {
  points: readonly HeatPoint[];
  /** A zónákban lévő cellák (csak saját módban): szürkén, nem színezve. */
  grey: readonly HeatPoint[];
  view: HeatView;
  res: number;
}

export interface HeatViewport {
  bbox: BBox;
  zoom: number;
}

/**
 * AW20: a hőtérkép adata a térképnek. Saját mód: a helyi összesítés (IndexedDB, utak végén frissül) a `HeatIndex`-ben,
 * zoom-függő felbontással; közösségi mód: a `heat_global` / `heat_global_r8` a látható területre (10 perces gyorsítótár).
 * A megosztás kikapcsolásakor a feltöltési sor törlődik.
 */
export function useHeat(opts: { mode: HeatMode; view: HeatView; share: boolean; version: number; viewport: HeatViewport | null; visible: boolean; zones: readonly HeatZone[] }): HeatLayer | null {
  const { mode, view, share, version, viewport, visible, zones } = opts;
  const [geo, setGeo] = useState<WebHeatGeo | null>(null);
  const [own, setOwn] = useState<readonly HeatCell[]>([]);
  const [globalRows, setGlobalRows] = useState<{ res: number; rows: readonly HeatGlobalRow[] } | null>(null);
  const need = mode !== 'ki';
  useEffect(() => {
    if (need) void heatGeo().then(setGeo);
  }, [need]);

  // a helyi összesítés: induláskor a még be nem olvasztott utak beolvasztása, utána minden út végén újratöltés
  const backfilled = useRef(false);
  useEffect(() => {
    if (!need || HEAT_SEED) return;
    let cancelled = false;
    void (async () => {
      if (!backfilled.current) {
        backfilled.current = true;
        await backfillHeat().catch((e: unknown) => console.warn('[heat] backfill failed', e));
      }
      const cells = await listHeat().catch(() => []);
      if (!cancelled) setOwn(cells);
    })();
    return () => {
      cancelled = true;
    };
  }, [need, version]);

  const seed = useMemo(() => (HEAT_SEED && geo ? heatSeedCells(geo.cellOf) : null), [geo]);
  // az index a tartalommal együtt épül (nem utólag, effektben): a pontok ugyanabban a renderben a friss cellákból készülnek
  const index = useMemo(() => {
    if (!geo) return null;
    const i = new HeatIndex(geo);
    i.setZones(zones);
    i.setAll(seed ?? own);
    return i;
  }, [geo, own, seed, zones]);

  // közösségi mód: lekérés a látható területre, 10 perc gyorsítótár
  const cache = useMemo(() => new HeatGlobalCache(() => Date.now()), []);
  useEffect(() => {
    if (mode !== 'kozossegi' || !viewport || !visible) return;
    const res = heatResForZoom(viewport.zoom);
    if (HEAT_SEED) {
      if (geo && seed) setGlobalRows({ res, rows: heatSeedGlobal(seed, geo, res) });
      return;
    }
    if (!supabase) return;
    const box = heatQueryBox(viewport.bbox);
    const key = heatQueryKey(box, res);
    const hit = cache.get(key);
    if (hit) {
      setGlobalRows({ res, rows: hit });
      return;
    }
    let cancelled = false;
    fetchHeatGlobal(supabase, box, res)
      .then((rows) => {
        cache.set(key, rows);
        if (!cancelled) setGlobalRows({ res, rows });
      })
      .catch((e: unknown) => console.warn('[heat] fetch failed', e));
    return () => {
      cancelled = true;
    };
  }, [mode, viewport, visible, cache, geo, seed]);

  // megosztás: kikapcsolva a várakozó sorok törlődnek; bekapcsolva induláskor próbáljuk a maradékot feltölteni
  useEffect(() => {
    if (!share) clearHeatOutbox();
    else void flushHeatOutbox(supabase);
  }, [share, version]);

  return useMemo(() => {
    if (!visible || mode === 'ki' || !viewport) return null;
    if (mode === 'sajat') {
      if (!index) return null;
      const r = index.points(viewport, view);
      return { points: r.points, grey: r.grey, view, res: r.res };
    }
    if (!globalRows) return null;
    return { points: globalPoints(globalRows.rows, view), grey: [], view, res: globalRows.res };
  }, [visible, mode, view, viewport, index, globalRows]);
}

export { HEAT };
