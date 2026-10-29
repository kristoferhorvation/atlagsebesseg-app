import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  addRecent,
  DirectionsError,
  NavigationSession,
  NO_ENFORCEMENT_DATA,
  NO_SAVED,
  parseRecents,
  parseSaved,
  RECENTS_KEY,
  routeSummary,
  SAVED_KEY,
  selectRouteById as pickRouteById,
  type EnforcementData,
  type NavRoute,
  type NavView,
  type Place,
  type RouteFetcher,
  type RouteSummary,
  type SavedPlaces,
  type SpeedUnit,
  type Lang,
} from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { syncStore } from './backend';
import { speak, stopSpeech, unlockSpeech } from './speech';

export type PlanStatus = 'nogps' | 'loading' | 'ready' | 'error' | 'ratelimited';

export interface PlanState {
  dest: Place;
  status: PlanStatus;
  routes: NavRoute[];
  selected: number;
}

/** Mit keresünk: úti célt, vagy a Haza / Munka mentett helyet (Beállításokból). */
export type SearchFor = 'dest' | 'home' | 'work';

export interface NavigationOptions {
  fix: GpsFix | null;
  fetchRoutes: RouteFetcher | null;
  loadData: (routes: readonly NavRoute[]) => Promise<EnforcementData>;
  now: () => number;
  unit: SpeedUnit;
  voice: boolean;
  lang: Lang;
  simMode: boolean;
}

/** Mentett helyek (Haza / Munka) és az utolsó 10 cél: localStorage, try/catch-csel. */
export function usePlaces() {
  const [recents, setRecents] = useState<Place[]>(() => parseRecents(syncStore.getItem(RECENTS_KEY)));
  const [saved, setSavedState] = useState<SavedPlaces>(() => parseSaved(syncStore.getItem(SAVED_KEY)));
  const pushRecent = useCallback((p: Place) => {
    setRecents((prev) => {
      const next = addRecent(prev, p);
      syncStore.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const setSaved = useCallback((kind: 'home' | 'work', place: Place | null) => {
    setSavedState((prev) => {
      const next = { ...prev, [kind]: place };
      syncStore.setItem(SAVED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { recents, saved: saved ?? NO_SAVED, pushRecent, setSaved };
}

/**
 * A navigáció webes kötése: keresés → tervezés (útvonalválasztó) → `NavigationSession`. A logika az
 * app-logic-ban van; ez csak az állapotot, a hangot és az útvonal-adat betöltését köti React-hez.
 */
export function useNavigation(o: NavigationOptions, places: ReturnType<typeof usePlaces>) {
  const [searchFor, setSearchFor] = useState<SearchFor | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [data, setData] = useState<EnforcementData>(NO_ENFORCEMENT_DATA);
  const [session, setSession] = useState<NavigationSession | null>(null);
  const opts = useRef(o);
  opts.current = o;

  // --- tervezés ---
  const planSeq = useRef(0);
  const requestPlan = useCallback((dest: Place) => {
    const { fix, fetchRoutes } = opts.current;
    const seq = ++planSeq.current;
    if (!fix || !fetchRoutes) {
      setPlan({ dest, status: 'nogps', routes: [], selected: 0 });
      return;
    }
    setPlan({ dest, status: 'loading', routes: [], selected: 0 });
    fetchRoutes({ lat: fix.lat, lon: fix.lon }, dest, { heading: fix.heading, reason: 'plan' }).then(
      (routes) => {
        if (seq !== planSeq.current) return;
        setPlan({ dest, status: 'ready', routes, selected: 0 });
        opts.current.loadData(routes).then(
          (d) => seq === planSeq.current && setData(d),
          () => undefined,
        );
      },
      (e: unknown) => {
        if (seq !== planSeq.current) return;
        setPlan({ dest, status: e instanceof DirectionsError && e.code === 'RateLimited' ? 'ratelimited' : 'error', routes: [], selected: 0 });
      },
    );
  }, []);

  const choose = useCallback(
    (place: Place) => {
      const kind = searchFor;
      setSearchFor(null);
      if (kind === 'home' || kind === 'work') places.setSaved(kind, place);
      else requestPlan(place);
    },
    [searchFor, places, requestPlan],
  );

  const retryPlan = useCallback(() => plan && requestPlan(plan.dest), [plan, requestPlan]);
  const selectRoute = useCallback((i: number) => setPlan((p) => (p ? { ...p, selected: i } : p)), []);
  /** Érintés a térképen egy alternatív vonalra / címkére (A8d): az lesz a kiválasztott, a kártya átvált. */
  const selectRouteById = useCallback((id: string) => setPlan((p) => (p ? { ...p, selected: pickRouteById(p.routes, p.selected, id) } : p)), []);
  const cancelPlan = useCallback(() => {
    planSeq.current++;
    setPlan(null);
  }, []);

  const summaries = useMemo<RouteSummary[]>(() => (plan?.routes ?? []).map((r) => routeSummary(r, data, opts.current.now())), [plan?.routes, data]);

  // --- navigáció ---
  const start = useCallback(() => {
    const p = plan;
    const fetchRoutes = opts.current.fetchRoutes;
    if (!p || p.status !== 'ready' || !fetchRoutes) return;
    const route = p.routes[p.selected]!;
    unlockSpeech();
    places.pushRecent(p.dest);
    const s = new NavigationSession(route, { name: p.dest.name, lat: p.dest.lat, lon: p.dest.lon }, {
      fetchRoutes,
      now: () => opts.current.now(),
      unit: opts.current.unit,
      voice: opts.current.voice,
    });
    s.setData(data);
    planSeq.current++;
    setPlan(null);
    setSession(s);
  }, [plan, data, places]);

  const end = useCallback(() => {
    setSession((s) => {
      s?.dispose();
      return null;
    });
    stopSpeech();
    setData(NO_ENFORCEMENT_DATA);
  }, []);

  // a beállítások követése
  useEffect(() => session?.setUnit(o.unit), [session, o.unit]);
  useEffect(() => {
    session?.setVoice(o.voice);
    if (!o.voice) stopSpeech();
  }, [session, o.voice]);
  useEffect(() => session?.setData(data), [session, data]);

  // hang: minden változás után a sorban várakozó mondatok felolvasása
  useEffect(() => {
    if (!session) return;
    const pump = () => {
      for (const v of session.drainVoice()) speak(v.text, opts.current.lang, v.kind, opts.current.simMode);
    };
    pump();
    return session.subscribe(pump);
  }, [session]);

  const view = useSyncExternalStore(
    useCallback((cb) => (session ? session.subscribe(cb) : () => undefined), [session]),
    useCallback(() => (session ? session.view() : null), [session]),
  );

  return {
    searchFor,
    openSearch: useCallback((kind: SearchFor = 'dest') => setSearchFor(kind), []),
    closeSearch: useCallback(() => setSearchFor(null), []),
    choose,
    planTo: requestPlan,
    plan,
    summaries,
    selectRoute,
    selectRouteById,
    retryPlan,
    cancelPlan,
    start,
    end,
    session,
    view: view as NavView | null,
  };
}
