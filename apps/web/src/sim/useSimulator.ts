import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GpsFix, Section } from '@atlagsebesseg/core';
import { buildSimulation, SCENARIOS, simRoutes, type SimScenario, type Simulation } from './scenarios';

export interface SimCallbacks {
  onFix: (fix: GpsFix) => void;
  onTick: () => void;
}

export const SIM_SPEEDS = [1, 4, 12] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

export interface SimStart {
  routeIdx: number;
  scenario: SimScenario;
  speed: SimSpeed;
  /** Ugrás a lejátszás ezen hányadára (0…1) – egy adott állapot azonnali megnézéséhez. */
  seek: number;
}

/**
 * Kezdőállapot az URL-ből (dizájn-iterációhoz): `?sim=jo&route=1&speed=12&seek=0.6`.
 * `sim` értéke a forgatókönyv (üresen „lassit”).
 */
export function simStartFromUrl(search: string): SimStart {
  const q = new URLSearchParams(search);
  const scenario = SCENARIOS.find((s) => s.id === q.get('sim'))?.id ?? 'lassit';
  const speed = SIM_SPEEDS.find((v) => v === Number(q.get('speed'))) ?? 4;
  const seek = Math.min(1, Math.max(0, Number(q.get('seek')) || 0));
  return { routeIdx: Math.max(0, Number(q.get('route')) || 0), scenario, speed, seek };
}

/**
 * Felvett (generált) GPS-útvonal lejátszása GPS nélkül: másodpercenként egy fix, gyorsítható.
 * Az óra a lejátszás ideje – a mérés-munkamenet ezt kapja `now`-ként.
 */
export function useSimulator(bundled: readonly Section[], cb: SimCallbacks, start: SimStart) {
  const routes = useMemo(() => simRoutes(bundled), [bundled]);
  const [routeId, setRouteId] = useState((routes[start.routeIdx] ?? routes[0]!).id);
  const [scenario, setScenario] = useState<SimScenario>(start.scenario);
  const [speed, setSpeed] = useState<SimSpeed>(start.speed);
  const seek = useRef(start.seek);
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const cbRef = useRef(cb);
  cbRef.current = cb;

  const route = routes.find((r) => r.id === routeId) ?? routes[0]!;
  const sim: Simulation = useMemo(() => buildSimulation(route, scenario), [route, scenario]);
  const clock = useRef(sim.samples[0]?.t ?? Date.now());
  const indexRef = useRef(0);

  // új forgatókönyv: elölről (az első betöltéskor az URL `seek` értékéig azonnal lejátszva)
  // (egy makrotaszkkal később: addigra a szülő a szimulált szakaszt is átadta a mérésnek)
  useEffect(() => {
    indexRef.current = 0;
    clock.current = sim.samples[0]?.t ?? Date.now();
    setIndex(0);
    setPlaying(false);
    const id = setTimeout(() => {
      const until = Math.floor(seek.current * sim.samples.length);
      seek.current = 0;
      for (; indexRef.current < until; indexRef.current++) {
        const s = sim.samples[indexRef.current]!;
        clock.current = s.t;
        if (s.dropped) cbRef.current.onTick();
        else cbRef.current.onFix(s.fix);
      }
      setIndex(indexRef.current);
      setPlaying(true);
    }, 0);
    return () => clearTimeout(id);
  }, [sim]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = sim.samples[indexRef.current];
      if (!s) {
        setPlaying(false);
        return;
      }
      clock.current = s.t;
      if (s.dropped) cbRef.current.onTick();
      else cbRef.current.onFix(s.fix);
      indexRef.current++;
      setIndex(indexRef.current);
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, sim]);

  const restart = useCallback(() => {
    indexRef.current = 0;
    setIndex(0);
    setPlaying(true);
  }, []);

  return {
    routes,
    route,
    section: route.section,
    scenario,
    setScenario,
    setRouteId,
    speed,
    setSpeed,
    playing,
    setPlaying,
    restart,
    progress: sim.samples.length ? index / sim.samples.length : 0,
    now: useCallback(() => clock.current, []),
  };
}

export type Simulator = ReturnType<typeof useSimulator>;
