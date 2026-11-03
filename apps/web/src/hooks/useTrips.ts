import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { measurementName, TRIP, TripRecorder, HEAT, uploadRows, type CruiseView, type HeatZone, type NavView, type SessionView } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { addSamples, absorbTrip, deleteSamples, saveTrip, purgeTrash } from '../trips/tripStore';
import { heatGeo } from '../heat/heatGeo';
import { enqueueHeatRows, flushHeatOutbox } from '../heat/heatShare';
import { supabase } from '../backend';

/**
 * AW19: a krúzing mód / utak naplója bekötése – a `TripRecorder` ugyanazokat a fixeket kapja, mint a mérés és a navigáció;
 * a navigáció (cél, újratervezés, dugó) és a mérés (befejezett szakasz) eseményei a futó útba kerülnek. A minták és a
 * lezárt utak sorrendtartóan, egy láncon kerülnek az IndexedDB-be. `version` nő, ha új út került a naplóba.
 */
/** Szimulátorban (`?sim`, `?navsim`, `?cruise`) a közösségi feltöltés nincs – a teszt-út ne kerüljön az éles táblába. */
const IS_SIM = ['sim', 'navsim', 'cruise'].some((k) => new URLSearchParams(location.search).has(k));

export function useTrips(now: () => number, nav: NavView | null, view: SessionView, share: boolean, zones: readonly HeatZone[]) {
  const shareRef = useRef(share);
  shareRef.current = share;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const rec = useMemo(() => new TripRecorder(), []);
  const [cruise, setCruise] = useState<CruiseView | null>(null);
  const [version, setVersion] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  // AOS17: a kuka 30 napnál régebbi sorai indításkor törlődnek
  useEffect(() => {
    void purgeTrash().catch((e: unknown) => console.warn('[trips] purge failed', e));
  }, []);

  /** Az út a naplóba, a személyes hőtérképbe (AW20, inkrementálisan) és – ha a megosztás be van kapcsolva – a feltöltési sorba. */
  const finishTrip = useCallback(async (trip: Parameters<typeof saveTrip>[0]) => {
    await saveTrip(trip);
    const absorbed = await absorbTrip(trip.id);
    if (!absorbed || !shareRef.current || IS_SIM) return;
    const geo = await heatGeo();
    if (!geo) return;
    enqueueHeatRows(uploadRows(absorbed.passes, geo, -new Date(trip.startedAt).getTimezoneOffset(), HEAT.shareEndsM, zonesRef.current));
    void flushHeatOutbox(supabase);
  }, []);

  const pump = useCallback(() => {
    const samples = rec.drainSamples();
    const ended = rec.drainEnded();
    const write = (job: () => Promise<void>) => {
      queue.current = queue.current.then(job).catch((e: unknown) => console.warn('[trips] store failed', e));
    };
    if (samples.length) write(() => addSamples(samples));
    for (const e of ended) {
      if (e.kind === 'saved') write(() => finishTrip(e.trip).then(() => setVersion((v) => v + 1)));
      else write(() => deleteSamples(e.id));
    }
    const v = rec.view(now());
    // az állapotsor 10 m-enként és percenként változik – nem minden fixnél új objektum
    setCruise((prev) =>
      prev && v && prev.tripId === v.tripId && Math.round(prev.distanceM / 10) === Math.round(v.distanceM / 10) && Math.floor(prev.elapsedS / 60) === Math.floor(v.elapsedS / 60) ? prev : v,
    );
  }, [rec, now, finishTrip]);

  const onFix = useCallback(
    (fix: GpsFix) => {
      rec.onFix(fix);
      pump();
    },
    [rec, pump],
  );
  /** A futó út pillanatképe a naplóba (az út nyitva marad) – ha az app a háttérben leáll, az út nem vész el. */
  const checkpoint = useCallback(() => {
    const snap = rec.snapshot();
    if (snap) queue.current = queue.current.then(() => saveTrip(snap)).then(() => setVersion((v) => v + 1)).catch((e: unknown) => console.warn('[trips] checkpoint failed', e));
  }, [rec]);
  const lastCheckpoint = useRef(0);
  const tick = useCallback(() => {
    rec.tick(now());
    pump();
    if (now() - lastCheckpoint.current >= TRIP.checkpointS * 1000) {
      lastCheckpoint.current = now();
      checkpoint();
    }
  }, [rec, now, pump, checkpoint]);
  /** A felhasználó megállította a GPS-t (a szimuláció vége): a futó út lezárul. Háttérbe kerüléstől NEM. */
  const stop = useCallback(() => {
    rec.stop();
    pump();
  }, [rec, pump]);

  // navigáció: a cél, az újratervezések (a felfutó él) és a helyi dugó-állapot
  const destination = nav?.destination.name ?? null;
  useEffect(() => rec.setDestination(destination), [rec, destination]);
  const rerouting = nav?.rerouting ?? false;
  useEffect(() => {
    if (rerouting) rec.noteReroute();
  }, [rec, rerouting]);
  const jam = nav?.jam ?? false;
  useEffect(() => rec.noteJam(jam, now()), [rec, jam, now]);

  // AW20: a navigáció tábla-limitje a mintákba (az út színezéséhez)
  const limitKmh = nav?.limitKmh ?? null;
  useEffect(() => rec.setLimit(limitKmh), [rec, limitKmh]);

  // a navigáció következő manővere: a teljesített manőverek adják a kanyarokat (krúzingban nincs → 0)
  const next = nav?.next ?? null;
  useEffect(() => {
    rec.noteNextManeuver(next ? { icon: next.icon, instruction: next.instruction, distanceM: next.distanceM } : null);
  }, [rec, next?.icon, next?.instruction, next?.distanceM]);

  // a befejezett szakaszmérés (egyszer eredményenként)
  const result = view.phase === 'befejezve' ? view.result : null;
  const lastResult = useRef<string | null>(null);
  useEffect(() => {
    if (!result || !view.section) return;
    const key = `${result.sectionId}:${result.exitTime}`;
    if (lastResult.current === key) return;
    lastResult.current = key;
    rec.noteMeasurement({
      sectionId: result.sectionId,
      name: measurementName(view.section),
      avgKmh: Math.round(result.averageKmh * 10) / 10,
      limitKmh: result.speedLimitKmh,
      tooFast: result.overLimit,
      at: result.exitTime,
    });
  }, [rec, result, view.section]);

  // AOS16: az „Összes törlése” után a hőtérkép is újratöltődik (a `version` a `useHeat` újraolvasását indítja)
  const touch = useCallback(() => setVersion((v) => v + 1), []);
  return { cruise, version, onFix, tick, stop, checkpoint, touch };
}
