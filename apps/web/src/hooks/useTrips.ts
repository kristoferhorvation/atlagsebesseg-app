import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { measurementName, TripRecorder, type CruiseView, type NavView, type SessionView } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { addSamples, deleteSamples, saveTrip } from '../trips/tripStore';

/**
 * AW19: a krúzing mód / utak naplója bekötése – a `TripRecorder` ugyanazokat a fixeket kapja, mint a mérés és a navigáció;
 * a navigáció (cél, újratervezés, dugó) és a mérés (befejezett szakasz) eseményei a futó útba kerülnek. A minták és a
 * lezárt utak sorrendtartóan, egy láncon kerülnek az IndexedDB-be. `version` nő, ha új út került a naplóba.
 */
export function useTrips(now: () => number, nav: NavView | null, view: SessionView) {
  const rec = useMemo(() => new TripRecorder(), []);
  const [cruise, setCruise] = useState<CruiseView | null>(null);
  const [version, setVersion] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const pump = useCallback(() => {
    const samples = rec.drainSamples();
    const ended = rec.drainEnded();
    const write = (job: () => Promise<void>) => {
      queue.current = queue.current.then(job).catch((e: unknown) => console.warn('[trips] store failed', e));
    };
    if (samples.length) write(() => addSamples(samples));
    for (const e of ended) {
      if (e.kind === 'saved') write(() => saveTrip(e.trip).then(() => setVersion((v) => v + 1)));
      else write(() => deleteSamples(e.id));
    }
    const v = rec.view(now());
    // az állapotsor 10 m-enként és percenként változik – nem minden fixnél új objektum
    setCruise((prev) =>
      prev && v && prev.tripId === v.tripId && Math.round(prev.distanceM / 10) === Math.round(v.distanceM / 10) && Math.floor(prev.elapsedS / 60) === Math.floor(v.elapsedS / 60) ? prev : v,
    );
  }, [rec, now]);

  const onFix = useCallback(
    (fix: GpsFix) => {
      rec.onFix(fix);
      pump();
    },
    [rec, pump],
  );
  const tick = useCallback(() => {
    rec.tick(now());
    pump();
  }, [rec, now, pump]);
  /** A GPS leállt (háttér, a szimuláció vége): a futó út lezárul. */
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

  return { cruise, version, onFix, tick, stop };
}
