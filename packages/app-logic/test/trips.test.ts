import type { GpsFix } from '@atlagsebesseg/core';
import { describe, expect, it } from 'vitest';
import { setLanguage } from '../src/i18n';
import {
  cruiseStatusText,
  headingDelta,
  maneuverTurnKind,
  normalizeTrip,
  periodStart,
  simplifyPath,
  tripAvgKmh,
  TripRecorder,
  tripRowParts,
  tripTotals,
  turnsTotal,
  TurnDetector,
  type Trip,
  type TripEnd,
} from '../src/trips';

// AW19: krúzing mód, utak naplója, statisztika (a Swift-pár: AtlagsebessegTests/TripTests.swift, azonos nevekkel)

const M_PER_DEG = 111_195;
const T0 = 1_800_000_000_000;

/** Észak felé haladó fixek másodpercenként: `[km/h, másodperc]` darabok (a pozíció a sebességből lép). */
function northDrive(parts: [number, number][], opts: { t0?: number; accuracy?: number | null; lat?: number } = {}): GpsFix[] {
  const out: GpsFix[] = [];
  let lat = opts.lat ?? 47.5;
  let t = opts.t0 ?? T0;
  for (const [kmh, secs] of parts) {
    for (let i = 0; i < secs; i++) {
      out.push({ lat, lon: 19.05, timestamp: t, speed: kmh / 3.6, accuracy: opts.accuracy === undefined ? 5 : opts.accuracy, heading: kmh >= 1 ? 0 : null });
      lat += kmh / 3.6 / M_PER_DEG;
      t += 1000;
    }
  }
  return out;
}

const ids = () => {
  let n = 0;
  return () => `trip-${++n}`;
};

function record(fixes: GpsFix[], stop = true): { rec: TripRecorder; ended: TripEnd[] } {
  const rec = new TripRecorder({ newId: ids() });
  for (const f of fixes) rec.onFix(f);
  if (stop) rec.stop();
  return { rec, ended: rec.drainEnded() };
}

const saved = (ended: TripEnd[]): Trip[] => ended.flatMap((e) => (e.kind === 'saved' ? [e.trip] : []));

describe('TripRecorder (indulás és zárás)', () => {
  it('a 30 s-os, legalább 10 km/h-s mozgás indítja az utat, a kezdete e szakasz eleje', () => {
    const fixes = northDrive([[0, 10], [36, 30]]);
    const rec = new TripRecorder({ newId: ids() });
    for (const f of fixes) rec.onFix(f);
    expect(rec.view(fixes.at(-1)!.timestamp)).toBeNull();
    const next = northDrive([[36, 1]], { t0: fixes.at(-1)!.timestamp + 1000, lat: fixes.at(-1)!.lat + 10 / M_PER_DEG });
    rec.onFix(next[0]!);
    const v = rec.view(next[0]!.timestamp)!;
    expect(v.startedAt).toBe(T0 + 10_000);
    expect(v.elapsedS).toBe(30);
    expect(v.distanceM).toBeCloseTo(300, 0);
  });

  it('10 km/h alá eső minta újraindítja a várakozást', () => {
    const rec = new TripRecorder({ newId: ids() });
    for (const f of northDrive([[36, 20], [8, 1], [36, 25]])) rec.onFix(f);
    expect(rec.view(T0 + 46_000)).toBeNull();
    for (const f of northDrive([[36, 6]], { t0: T0 + 46_000 })) rec.onFix(f);
    expect(rec.view(T0 + 51_000)?.startedAt).toBe(T0 + 21_000);
  });

  it('5 perc állás zárja az utat, a vége az utolsó mozgó minta, a záró állás nem része', () => {
    const { ended } = record(northDrive([[54, 120], [0, 301]]), false);
    const [trip] = saved(ended);
    expect(trip).toBeDefined();
    expect(trip!.startedAt).toBe(T0);
    expect(trip!.endedAt).toBe(T0 + 119_000);
    expect(trip!.idleS).toBe(0);
    expect(trip!.movingS).toBe(119);
    expect(trip!.samples).toBe(120);
  });

  it('az út közbeni állás állásidő, a menetidőbe nem számít; az átlag a menetidőre', () => {
    const [trip] = saved(record(northDrive([[72, 100], [0, 60], [72, 100]])).ended);
    expect(trip!.idleS).toBe(60);
    expect(trip!.movingS).toBe(199);
    // 199 mozgó másodperc; a megállás előtti utolsó 20 m az állás első mintájára esik (állás közben nincs táv)
    expect(trip!.distanceM).toBe(Math.round(198 * 20));
    expect(tripAvgKmh(trip!)).toBeCloseTo(72, 0);
    expect(trip!.maxKmh).toBe(72);
  });

  it('a GPS leállása lezárja a futó utat', () => {
    const { rec, ended } = record(northDrive([[50, 60]]), false);
    expect(ended).toEqual([]);
    rec.stop();
    const [trip] = saved(rec.drainEnded());
    expect(trip!.endedAt).toBe(T0 + 59_000);
    expect(rec.view(T0 + 60_000)).toBeNull();
  });

  it('fix nélküli csend (háttér, GPS-kiesés) nem zárja az utat', () => {
    const rec = new TripRecorder({ newId: ids() });
    for (const f of northDrive([[50, 60]])) rec.onFix(f);
    rec.tick(T0 + 59_000 + 3_600_000);
    expect(rec.drainEnded()).toEqual([]);
    expect(rec.view(T0 + 3_700_000)).not.toBeNull();
  });

  it('rés után 500 m-en belül ugyanaz az út, a kieső idő állásidő', () => {
    const rec = new TripRecorder({ newId: ids() });
    for (const f of northDrive([[50, 60]])) rec.onFix(f);
    // 6 perc csend, aztán közel (kb. 100 m-re) a régi helytől folytatódik
    const resume = northDrive([[50, 60]], { t0: T0 + 59_000 + 360_000, lat: 47.5 + 800 / M_PER_DEG });
    for (const f of resume) rec.onFix(f);
    expect(rec.drainEnded()).toEqual([]);
    rec.stop();
    const [trip] = saved(rec.drainEnded());
    expect(saved(rec.drainEnded())).toEqual([]);
    expect(trip!.idleS).toBeGreaterThanOrEqual(360);
    expect(trip!.movingS).toBeLessThan(125);
    expect(trip!.path.length).toBe(2);
  });

  it('rés után 500 m-nél messzebb új út indul', () => {
    const rec = new TripRecorder({ newId: ids() });
    for (const f of northDrive([[50, 60]])) rec.onFix(f);
    const far = northDrive([[50, 60]], { t0: T0 + 59_000 + 360_000, lat: 47.5 + 5000 / M_PER_DEG });
    for (const f of far) rec.onFix(f);
    const first = saved(rec.drainEnded());
    expect(first).toHaveLength(1);
    expect(first[0]!.endedAt).toBe(T0 + 59_000);
    rec.stop();
    const second = saved(rec.drainEnded());
    expect(second).toHaveLength(1);
    expect(second[0]!.id).not.toBe(first[0]!.id);
  });

  it('a pillanatkép nem zárja az utat, és rövid útról nincs', () => {
    const rec = new TripRecorder({ newId: ids() });
    expect(rec.snapshot()).toBeNull();
    for (const f of northDrive([[50, 90]])) rec.onFix(f);
    const snap = rec.snapshot();
    expect(snap!.distanceM).toBeGreaterThan(900);
    expect(rec.view(T0 + 90_000)).not.toBeNull();
    expect(rec.drainEnded()).toEqual([]);
  });

  it('200 m alatti út eldobódik', () => {
    const { ended } = record(northDrive([[15, 40]]));
    expect(ended).toEqual([{ kind: 'discarded', id: 'trip-1' }]);
  });
});

describe('TripRecorder (minták és távolság)', () => {
  it('ugrás (> 250 km/h) nem ad távolságot, az útvonal új darabot kezd', () => {
    const a = northDrive([[72, 60]]);
    const b = northDrive([[72, 60]], { t0: a.at(-1)!.timestamp + 1000, lat: 48.0 });
    const [trip] = saved(record([...a, ...b]).ended);
    expect(trip!.distanceM).toBe(Math.round(118 * 20));
    expect(trip!.path).toHaveLength(2);
  });

  it('rossz pontosságú minta nem ad távolságot és max sebességet', () => {
    const good = northDrive([[72, 60]]);
    const bad = northDrive([[144, 10]], { t0: good.at(-1)!.timestamp + 1000, lat: good.at(-1)!.lat + 20 / M_PER_DEG, accuracy: 80 });
    const [trip] = saved(record([...good, ...bad]).ended);
    expect(trip!.maxKmh).toBe(72);
    expect(trip!.distanceM).toBe(Math.round(59 * 20));
    expect(trip!.samples).toBe(70);
  });

  it('1 Hz: a sűrűbb fixekből csak egy minta kerül a tárolóba', () => {
    const fixes = northDrive([[72, 60]]).flatMap((f) => [f, { ...f, timestamp: f.timestamp + 400 }]);
    const { rec } = record(fixes);
    const samples = rec.drainSamples();
    expect(samples).toHaveLength(60);
    expect(samples[0]).toEqual({ tripId: 'trip-1', t: T0, lat: 47.5, lon: 19.05, speedKmh: 72, heading: 0, accuracy: 5, h3: null, limitKmh: null });
  });

  it('a sebesség hiányában a két fix közti távolságból számol', () => {
    const fixes = northDrive([[72, 60]]).map((f) => ({ ...f, speed: null }));
    const [trip] = saved(record(fixes).ended);
    expect(trip!.distanceM).toBe(Math.round(58 * 20));
    expect(trip!.maxKmh).toBeCloseTo(72, 0);
  });
});

describe('TurnDetector (kanyarok)', () => {
  /** Irány-sor másodpercenként. */
  const feed = (headings: number[]) => {
    const d = new TurnDetector();
    headings.forEach((h, i) => d.feed(i * 1000, h));
    d.finish();
    return d.turns;
  };

  it('jobbra, balra kanyar és megfordulás az irányból', () => {
    expect(feed([0, 0, 0, 30, 60, 90, 90, 90, 90, 90])).toEqual({ left: 0, right: 1, uTurn: 0 });
    expect(feed([90, 90, 90, 60, 30, 0, 0, 0, 0, 0])).toEqual({ left: 1, right: 0, uTurn: 0 });
    expect(feed([0, 0, 40, 80, 120, 160, 180, 180, 180, 180, 180])).toEqual({ left: 0, right: 0, uTurn: 1 });
    // a 0°/360° átmenet is folytonos
    expect(feed([340, 340, 350, 20, 50, 70, 70, 70, 70])).toEqual({ left: 0, right: 1, uTurn: 0 });
  });

  it('lassú, 60°-os ív 5 s-nál hosszabb idő alatt nem kanyar', () => {
    expect(feed([0, 10, 20, 30, 40, 50, 60, 60, 60, 60])).toEqual({ left: 0, right: 0, uTurn: 0 });
  });

  it('S-kanyar (jobbra, majd azonnal vissza) nem kanyar', () => {
    expect(feed([0, 0, 35, 70, 35, 0, 0, 0, 0, 0])).toEqual({ left: 0, right: 0, uTurn: 0 });
  });

  it('két egymás utáni kanyar külön számít', () => {
    expect(feed([0, 0, 45, 90, 90, 90, 90, 135, 180, 180, 180, 180])).toEqual({ left: 0, right: 2, uTurn: 0 });
  });

  it('headingDelta: előjeles, −180…180', () => {
    expect(headingDelta(10, 350)).toBe(20);
    expect(headingDelta(350, 10)).toBe(-20);
    expect(headingDelta(90, 0)).toBe(90);
    expect(Math.abs(headingDelta(180, 0))).toBe(180);
  });
});

describe('TripRecorder (navigáció és mérés)', () => {
  it('a cél, az újratervezések, a dugóidő és a szakaszmérések a futó útba kerülnek', () => {
    const rec = new TripRecorder({ newId: ids() });
    rec.setDestination('Győr');
    const fixes = northDrive([[72, 200]]);
    fixes.forEach((f, i) => {
      rec.onFix(f);
      if (i === 50) rec.noteReroute();
      if (i === 60) rec.noteJam(true, f.timestamp);
      if (i === 100) rec.noteJam(false, f.timestamp);
      if (i === 150) rec.noteJam(true, f.timestamp);
      if (i === 120) rec.noteMeasurement({ sectionId: 'S1', name: 'M1 · Budapest → Győr', avgKmh: 118, limitKmh: 110, tooFast: true, at: f.timestamp });
    });
    rec.stop();
    const [trip] = saved(rec.drainEnded());
    expect(trip!.destination).toBe('Győr');
    expect(trip!.reroutes).toBe(1);
    expect(trip!.jamS).toBe(40 + 49);
    expect(trip!.measurements).toHaveLength(1);
    expect(trip!.measurements[0]!.tooFast).toBe(true);
  });

  it('a navigáció előtt indult út a később adott célt kapja', () => {
    const rec = new TripRecorder({ newId: ids() });
    const fixes = northDrive([[72, 100]]);
    fixes.forEach((f, i) => {
      rec.onFix(f);
      if (i === 60) rec.setDestination('Győr');
    });
    rec.stop();
    expect(saved(rec.drainEnded())[0]!.destination).toBe('Győr');
  });
});

describe('kanyarok (navigáció) és irányváltások (GPS)', () => {
  /** Jobbra kanyar a GPS-ben: észak, majd 2 s alatt kelet felé fordul. */
  const withRightTurn = (): GpsFix[] => {
    const f = northDrive([[50, 60]]);
    let { lat, lon } = f.at(-1)!;
    let t = f.at(-1)!.timestamp;
    const heads = [30, 60, 90, 90, 90, 90, 90, 90];
    for (const h of heads) {
      t += 1000;
      lat += (50 / 3.6 / M_PER_DEG) * Math.cos((h * Math.PI) / 180);
      lon += (50 / 3.6 / M_PER_DEG) * Math.sin((h * Math.PI) / 180);
      f.push({ lat, lon, timestamp: t, speed: 50 / 3.6, accuracy: 5, heading: h });
    }
    return f.concat(northDrive([[50, 1]], { t0: t + 1000, lat }).map((g, i) => ({ ...g, lon: lon + (i + 1) * 0.0001, heading: 90 })));
  };

  it('krúzingban a kanyar 0, az irányváltás számol', () => {
    const { ended } = record(withRightTurn());
    const [trip] = saved(ended);
    expect(trip!.turns).toEqual({ left: 0, right: 0, uTurn: 0 });
    expect(trip!.dirChanges.right).toBe(1);
  });

  it('a navigáció teljesített manőverei adják a kanyarokat', () => {
    const rec = new TripRecorder({ newId: ids() });
    const fixes = northDrive([[50, 120]]);
    const man = (icon: string, instruction: string, distanceM: number) => ({ icon, instruction, distanceM });
    fixes.forEach((f, i) => {
      rec.onFix(f);
      if (i === 40) rec.noteNextManeuver(man('right', 'Fordulj jobbra', 300));
      if (i === 50) rec.noteNextManeuver(man('right', 'Fordulj jobbra', 40));
      if (i === 52) rec.noteNextManeuver(man('roundabout_left', 'Körforgalom', 500));
      if (i === 70) rec.noteNextManeuver(man('roundabout_left', 'Körforgalom', 30));
      if (i === 72) rec.noteNextManeuver(man('uturn', 'Fordulj vissza', 900));
      // újratervezés: a manőver messziről cserélődik → nem teljesítették
      if (i === 90) rec.noteNextManeuver(man('left', 'Fordulj balra', 200));
      if (i === 100) rec.noteNextManeuver(man('arrive', 'Megérkeztél', 100));
    });
    rec.stop();
    const [trip] = saved(rec.drainEnded());
    expect(trip!.turns).toEqual({ left: 1, right: 1, uTurn: 0 });
  });

  it('maneuverTurnKind: balra / jobbra / megfordulás, az enyhe és az egyenes nem kanyar', () => {
    expect(['left', 'sharp_left', 'roundabout_left'].map(maneuverTurnKind)).toEqual(['left', 'left', 'left']);
    expect(['right', 'sharp_right', 'roundabout_right'].map(maneuverTurnKind)).toEqual(['right', 'right', 'right']);
    expect(maneuverTurnKind('uturn')).toBe('uTurn');
    expect(['slight_left', 'slight_right', 'straight', 'merge', 'fork_left', 'arrive', 'depart'].map(maneuverTurnKind)).toEqual([null, null, null, null, null, null, null]);
  });

  it('normalizeTrip: a régi rekord GPS-es kanyarja irányváltás lesz, a kanyar 0', () => {
    const old = { turns: { left: 1, right: 2, uTurn: 0 } } as unknown as Trip;
    expect(normalizeTrip(old).dirChanges).toEqual({ left: 1, right: 2, uTurn: 0 });
    expect(normalizeTrip(old).turns).toEqual({ left: 0, right: 0, uTurn: 0 });
    const cur = { turns: { left: 1, right: 0, uTurn: 0 }, dirChanges: { left: 3, right: 0, uTurn: 0 } } as unknown as Trip;
    expect(normalizeTrip(cur)).toBe(cur);
    expect(turnsTotal({ left: 1, right: 2, uTurn: 3 })).toBe(6);
  });
});

describe('simplifyPath (Douglas–Peucker)', () => {
  it('egyenes vonal két pontra egyszerűsödik, a 10 m-nél nagyobb kitérés megmarad', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lat: 47.5 + (i * 20) / M_PER_DEG, lon: 19.05 }));
    expect(simplifyPath(line)).toHaveLength(2);
    const bump = line.map((p, i) => (i === 25 ? { lat: p.lat, lon: p.lon + 15 / (M_PER_DEG * Math.cos((47.5 * Math.PI) / 180)) } : p));
    expect(simplifyPath(bump)).toHaveLength(5);
    const small = line.map((p, i) => (i === 25 ? { lat: p.lat, lon: p.lon + 8 / (M_PER_DEG * Math.cos((47.5 * Math.PI) / 180)) } : p));
    expect(simplifyPath(small)).toHaveLength(2);
  });

  it('a rekord útvonala egyszerűsített, 6 tizedesre kerekített', () => {
    const [trip] = saved(record(northDrive([[72, 100]])).ended);
    expect(trip!.path).toHaveLength(1);
    expect(trip!.path[0]).toHaveLength(2);
    expect(trip!.path[0]![0]).toEqual([47.5, 19.05]);
  });
});

describe('tripTotals (statisztika)', () => {
  const mk = (id: string, startedAt: number, km: number, movingS: number, tooFast: boolean[] = []): Trip => ({
    id,
    startedAt,
    endedAt: startedAt + movingS * 1000,
    distanceM: km * 1000,
    movingS,
    idleS: 0,
    maxKmh: 100,
    turns: { left: 1, right: 2, uTurn: 0 },
    dirChanges: { left: 4, right: 5, uTurn: 1 },
    reroutes: 0,
    measurements: tooFast.map((f, i) => ({ sectionId: `S${i}`, name: 'M1', avgKmh: 100, limitKmh: 110, tooFast: f, at: startedAt })),
    jamS: 60,
    destination: null,
    path: [],
    samples: 0,
  });
  // 2026-10-29 csütörtök 12:00 (helyi idő)
  const now = new Date(2026, 9, 29, 12).getTime();

  it('az időszak kezdete: a hét hétfője 0:00, a hónap 1-je 0:00, összesnél nincs', () => {
    expect(periodStart('het', now)).toBe(new Date(2026, 9, 26).getTime());
    expect(periodStart('honap', now)).toBe(new Date(2026, 9, 1).getTime());
    expect(periodStart('osszes', now)).toBeNull();
    // vasárnap még az előző hétfőhöz tartozik
    expect(periodStart('het', new Date(2026, 10, 1, 20).getTime())).toBe(new Date(2026, 9, 26).getTime());
  });

  it('hét, hónap, összes; az átlag a menetidőre', () => {
    const trips = [
      mk('a', new Date(2026, 9, 28, 8).getTime(), 30, 1800, [false, true]),
      mk('b', new Date(2026, 9, 20, 8).getTime(), 60, 1800, [false]),
      mk('c', new Date(2026, 8, 20, 8).getTime(), 10, 600),
    ];
    const week = tripTotals(trips, 'het', now);
    expect({ ...week, avgKmh: Math.round(week.avgKmh! * 1e6) / 1e6 }).toEqual({ trips: 1, distanceM: 30_000, movingS: 1800, avgKmh: 60, turns: { left: 1, right: 2, uTurn: 0 }, dirChanges: { left: 4, right: 5, uTurn: 1 }, checksOk: 1, checksTooFast: 1, jamS: 60 });
    const month = tripTotals(trips, 'honap', now);
    expect(month.trips).toBe(2);
    expect(month.avgKmh).toBeCloseTo(90, 9);
    expect(month.checksOk).toBe(2);
    const all = tripTotals(trips, 'osszes', now);
    expect(all.trips).toBe(3);
    expect(all.distanceM).toBe(100_000);
    expect(all.turns).toEqual({ left: 3, right: 6, uTurn: 0 });
    expect(tripTotals([], 'osszes', now).avgKmh).toBeNull();
  });
});

describe('feliratok (napló)', () => {
  it('cruiseStatusText: „Krúzing · 12,4 km · 23 perc”', () => {
    setLanguage('hu');
    expect(cruiseStatusText({ distanceM: 12_400, elapsedS: 23 * 60 }, 'kmh')).toBe('Krúzing · 12,4 km · 23 perc');
    expect(cruiseStatusText({ distanceM: 640, elapsedS: 20 }, 'kmh')).toBe('Krúzing · 640 m · 1 perc');
    setLanguage('en');
    expect(cruiseStatusText({ distanceM: 12_400, elapsedS: 83 * 60 }, 'mph')).toBe('Cruising · 7.7 mi · 1 h 23 min');
    setLanguage('hu');
  });

  it('tripRowParts: cél vagy „Krúzing” · táv · menetidő · átlag', () => {
    setLanguage('hu');
    const trip = saved(record(northDrive([[72, 100]])).ended)[0]!;
    expect(tripRowParts(trip, 'kmh')).toEqual({ title: 'Krúzing', distance: '2,0 km', duration: '2 perc', avg: '72 km/h', turns: '0 kanyar · 0 irányváltás' });
    expect(tripRowParts({ ...trip, destination: 'Győr' }, 'kmh').title).toBe('Győr');
  });
});
