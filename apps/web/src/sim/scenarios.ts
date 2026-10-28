import type { ActiveReport, CameraType, FixedCamera, PlannedCheck } from '@atlagsebesseg/app-logic';
import { bearingDeg, LocalProjection, polylineLengthM, type LatLon, type Section } from '@atlagsebesseg/core';
// A core tesztjeinek vezetés-generátora (Route menti mozgás, zaj, alagút) – ugyanaz, amin a core tesztel.
import { drive, testCourse, toLatLon, type DriveSample } from '@atlagsebesseg/core/test/helpers/trace';

export type SimScenario = 'jo' | 'tul' | 'lassit' | 'alagut' | 'tervezett';

export const SCENARIOS: readonly { id: SimScenario; label: string }[] = [
  { id: 'jo', label: 'Jó ütem' },
  { id: 'tul', label: 'Túl gyors' },
  { id: 'lassit', label: 'Gyors, majd lassít' },
  { id: 'alagut', label: 'Alagút' },
  { id: 'tervezett', label: 'Tervezett mérés + kamerák' },
];

export interface SimRoute {
  id: string;
  label: string;
  section: Section;
}

export interface Simulation {
  section: Section;
  samples: DriveSample[];
  /** A szakasz kezdete a pálya mentén (m) – előtte rávezető út. */
  leadInM: number;
}

const LEAD_IN_M = 1800;
const LEAD_OUT_M = 600;

/** A választható útvonalak: a core tesztpályája + a leghosszabb beépített szakaszok (geometriával). */
export function simRoutes(bundled: readonly Section[], max = 6): SimRoute[] {
  const test = testCourse().section;
  const real = [...bundled]
    .filter((s) => (s.geometry?.length ?? 0) >= 2 && s.lengthM >= 2000)
    .sort((a, b) => b.lengthM - a.lengthM)
    .slice(0, max);
  return [
    { id: test.id, label: `Tesztpálya · ${(test.lengthM / 1000).toFixed(0)} km`, section: test },
    ...real.map((s) => ({ id: s.id, label: `${s.road} ${s.direction} · ${(s.lengthM / 1000).toFixed(1)} km`.replace(/\s+/g, ' '), section: s })),
  ];
}

/** Sebességprofil a szakaszon megtett hányad (0…1, előtte < 0) függvényében. */
function profile(scenario: SimScenario, limit: number): (f: number) => number {
  switch (scenario) {
    case 'jo':
      return () => limit - 9;
    case 'tul':
      return () => limit + 14;
    case 'lassit':
      return (f) => (f < 0.45 ? limit + 16 : limit - 22);
    case 'alagut':
      return () => limit - 6;
    case 'tervezett':
      return () => limit - 9;
  }
}

/** Rávezető és kivezető egyenes a szakasz két végén, a szakasz irányában. */
function extendPath(section: Section): { path: LatLon[]; leadInM: number } {
  const g = section.geometry?.length ? section.geometry : [section.start, section.end];
  const first = g[0]!;
  const second = g[1] ?? section.end;
  const last = g[g.length - 1]!;
  const beforeLast = g[g.length - 2] ?? section.start;
  const proj = new LocalProjection(first);
  const dirIn = (bearingDeg(first, second) * Math.PI) / 180;
  const dirOut = (bearingDeg(beforeLast, last) * Math.PI) / 180;
  const lastXY = proj.toXY(last);
  const leadIn: LatLon[] = [];
  for (let d = LEAD_IN_M; d > 0; d -= 100) leadIn.push(proj.fromXY({ x: -Math.sin(dirIn) * d, y: -Math.cos(dirIn) * d }));
  const leadOut: LatLon[] = [];
  for (let d = 100; d <= LEAD_OUT_M; d += 100) leadOut.push(proj.fromXY({ x: lastXY.x + Math.sin(dirOut) * d, y: lastXY.y + Math.cos(dirOut) * d }));
  return { path: [...leadIn, ...g, ...leadOut], leadInM: polylineLengthM([...leadIn, first]) };
}

/** Egy lejátszható vezetés: másodpercenkénti fixek a rávezetőtől a kivezetőig. */
export function buildSimulation(route: SimRoute, scenario: SimScenario, t0 = Date.now()): Simulation {
  const section = route.section;
  const isTest = section.id === testCourse().section.id;
  const { path, leadInM } = isTest
    ? { path: toLatLon(testCourse().fullXY), leadInM: testCourse().leadInM }
    : extendPath(section);
  const len = section.lengthM;
  const speed = profile(scenario, section.speedLimitKmh);
  const samples = drive({
    path,
    t0,
    noiseM: 2.5,
    accuracy: 6,
    seed: 7,
    // a rávezetőn kicsit lassabban, hogy a közeledés látszódjon
    speedKmh: (s) => (s < leadInM ? Math.min(speed(0), section.speedLimitKmh) : speed((s - leadInM) / len)),
    dropRanges: scenario === 'alagut' ? [[leadInM + len * 0.35, leadInM + len * 0.5]] : [],
  });
  return { section, samples, leadInM };
}

/** Minta-bejelentések a szimulált út mentén: típus, a pálya hányada, hány perce jelentették. */
const SIM_REPORTS: readonly { type: ActiveReport['type']; gateKind?: 'kezdo' | 'zaro'; at: number; agoMin: number }[] = [
  { type: 'rendorseg', at: 0.08, agoMin: 12 },
  { type: 'akadaly', at: 0.25, agoMin: 3 },
  { type: 'traffipax', at: 0.42, agoMin: 41 },
  { type: 'baleset', at: 0.6, agoMin: 7 },
  { type: 'ideiglenes_kapu', gateKind: 'kezdo', at: 0.75, agoMin: 95 },
  { type: 'utlezaras', at: 0.9, agoMin: 26 },
];

/** A szimulátor bejelentései (a szerver helyett) – hogy a térkép-ikonok és a kártya látszódjanak. */
export function simReports(sim: Simulation): ActiveReport[] {
  const n = sim.samples.length;
  const t0 = sim.samples[0]?.t ?? Date.now();
  return SIM_REPORTS.flatMap((r, i) => {
    const fix = sim.samples[Math.min(n - 1, Math.floor(r.at * n))]?.fix;
    if (!fix) return [];
    const createdAt = t0 - r.agoMin * 60_000;
    return [
      {
        id: `sim-${sim.section.id}-${i}`,
        type: r.type,
        gateKind: r.gateKind ?? null,
        lat: fix.lat,
        lon: fix.lon,
        headingDeg: fix.heading,
        createdAt,
        expiresAt: createdAt + 2 * 3600_000,
        confirmations: 0,
        denials: 0,
        own: false,
      },
    ];
  });
}

/** A pálya [from, to] hányada a lejátszott fixekből (minden 3. pont) – a szimulált vonalakhoz. */
function pathSlice(sim: Simulation, from: number, to: number): LatLon[] {
  const fixes = sim.samples.filter((s) => !s.dropped).map((s) => s.fix);
  const a = Math.floor(from * fixes.length);
  const b = Math.min(fixes.length - 1, Math.ceil(to * fixes.length));
  return fixes.slice(a, b + 1).filter((_, i, arr) => i % 3 === 0 || i === arr.length - 1).map((f) => ({ lat: f.lat, lon: f.lon }));
}

/**
 * A „tervezett” forgatókönyv tervezett mérése: a rávezető út második felétől a szakasz közepéig
 * (így előbb nagy sávként, majd mérés közben kicsiként látszik). Más forgatókönyvben nincs.
 */
export function simPlannedChecks(sim: Simulation, scenario: SimScenario): PlannedCheck[] {
  if (scenario !== 'tervezett') return [];
  const t0 = sim.samples[0]?.t ?? Date.now();
  const n = sim.samples.length;
  const leadShare = sim.samples.findIndex((x) => x.s >= sim.leadInM) / n;
  const line = pathSlice(sim, Math.max(0.03, leadShare * 0.35), Math.min(0.9, leadShare + (1 - leadShare) * 0.45));
  // a hét hétfőjétől vasárnapjáig, mint a valódi közzétett hét
  const day = new Date(t0);
  const monday = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return [
    {
      id: `sim-planned-${sim.section.id}`,
      country: sim.section.country,
      county: 'Szimulátor',
      settlement: null,
      roadRef: sim.section.road || null,
      description: 'Szimulált tervezett mérés',
      lines: [line],
      speedLimitKmh: sim.section.speedLimitKmh,
      limitSource: 'osm',
      validFrom: monday - 3600_000,
      validTo: monday + 7 * 86400_000 - 3600_000 - 1000,
      timeWindow: null,
      sourceUrl: 'https://www.police.hu/',
    },
  ];
}

const SIM_CAMERAS: readonly { type: CameraType; at: number; verified: boolean }[] = [
  { type: 'complex', at: 0.18, verified: true },
  { type: 'speed', at: 0.52, verified: false },
  { type: 'red_light', at: 0.86, verified: false },
];

/** Fix kamerák az út szélén (20 m-re a pályától) – a „tervezett” forgatókönyvben. */
export function simCameras(sim: Simulation, scenario: SimScenario): FixedCamera[] {
  if (scenario !== 'tervezett') return [];
  const fixes = sim.samples.filter((s) => !s.dropped).map((s) => s.fix);
  return SIM_CAMERAS.flatMap((c, i) => {
    const f = fixes[Math.floor(c.at * fixes.length)];
    if (!f) return [];
    const proj = new LocalProjection(f);
    const h = ((f.heading ?? 0) * Math.PI) / 180;
    const p = proj.fromXY({ x: Math.cos(h) * 20, y: -Math.sin(h) * 20 });
    return [
      {
        id: `sim-cam-${sim.section.id}-${i}`,
        country: sim.section.country,
        type: c.type,
        lat: p.lat,
        lon: p.lon,
        headingDeg: f.heading,
        road: sim.section.road,
        speedLimitKmh: sim.section.speedLimitKmh,
        source: c.verified ? 'Szimulátor (VÉDA-minta)' : 'Szimulátor (OSM-minta)',
        sourceUrl: 'https://www.openstreetmap.org/',
        sourceDate: '2026-10-28',
        verified: c.verified,
      },
    ];
  });
}
