import { describe, expect, it } from 'vitest';
import { BUNDLED_SECTIONS } from '@atlagsebesseg/app-logic/bundled-sections';
import { TrackingSession } from '@atlagsebesseg/app-logic';
import { buildSimulation, simReports, simRoutes, type SimScenario } from './scenarios';

/** Lejátszás a mérés-munkamenettel: a szimulált vezetés valóban végigmegy az állapotokon. */
function play(routeIdx: number, scenario: SimScenario) {
  const routes = simRoutes(BUNDLED_SECTIONS);
  const route = routes[routeIdx]!;
  const sim = buildSimulation(route, scenario, 1_700_000_000_000);
  let t = sim.samples[0]!.t;
  const session = new TrackingSession([...BUNDLED_SECTIONS, route.section], { now: () => t });
  const phases = new Set<string>();
  for (const s of sim.samples) {
    t = s.t;
    phases.add((s.dropped ? session.tick() : session.onFix(s.fix)).phase);
  }
  return { phases, end: session.view(), route };
}

describe('szimulátor', () => {
  it('útvonalak: tesztpálya + beépített szakaszok', () => {
    const routes = simRoutes(BUNDLED_SECTIONS);
    expect(routes[0]!.id).toBe('TEST-1');
    expect(routes.length).toBeGreaterThan(1);
  });

  it('tesztpálya, túl gyors: mérés, majd befejezve „túl”', () => {
    const { phases, end } = play(0, 'tul');
    expect([...phases]).toEqual(expect.arrayContaining(['kozeledik', 'meres', 'befejezve']));
    expect(end.status).toBe('tul_gyors');
  });

  it('valódi (beépített) szakasz, jó ütem: befejezve „jó”', () => {
    const { phases, end, route } = play(1, 'jo');
    expect(phases.has('meres')).toBe(true);
    expect(end.phase).toBe('befejezve');
    expect(end.result!.sectionId).toBe(route.id);
    expect(end.status).toBe('jo');
  });

  it('„gyors, majd lassít”: mind a 3 állapot látszik, ebben a sorrendben', () => {
    for (const routeIdx of [0, 1]) {
      const route = simRoutes(BUNDLED_SECTIONS)[routeIdx]!;
      const sim = buildSimulation(route, 'lassit', 1_700_000_000_000);
      let t = sim.samples[0]!.t;
      const session = new TrackingSession([...BUNDLED_SECTIONS, route.section], { now: () => t });
      const order: string[] = [];
      sim.samples.forEach((s) => {
        t = s.t;
        const v = s.dropped ? session.tick() : session.onFix(s.fix);
        if (v.phase === 'meres' && v.status && order[order.length - 1] !== v.status) order.push(v.status);
      });
      expect(order).toEqual(['tul_gyors', 'lassits', 'jo']);
    }
  });

  it('alagút: kiesés alatt becsült, a végén van eredmény', () => {
    const { end } = play(0, 'alagut');
    expect(end.phase).toBe('befejezve');
  });
});

describe('szimulátor minta-bejelentései', () => {
  it('az út mentén, különböző típusokkal, le nem járva', () => {
    const route = simRoutes(BUNDLED_SECTIONS)[0]!;
    const sim = buildSimulation(route, 'jo', 1_700_000_000_000);
    const reps = simReports(sim);
    expect(reps.length).toBeGreaterThanOrEqual(5);
    expect(new Set(reps.map((r) => r.type)).size).toBe(reps.length);
    expect(new Set(reps.map((r) => r.id)).size).toBe(reps.length);
    const t = sim.samples[0]!.t;
    for (const r of reps) {
      expect(r.createdAt).toBeLessThan(t);
      expect(r.expiresAt).toBeGreaterThan(t);
    }
  });
});
