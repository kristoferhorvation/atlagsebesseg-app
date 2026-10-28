import { describe, expect, it } from 'vitest';
import { SectionTracker, type TrackerSnapshot, type TrackerState } from '../src/tracker';
import type { GpsFix, Section } from '../src/types';
import { loadDrive, loadSections } from './helpers/fixtures';
import { fixes, trueTimeAt, type DriveSample } from './helpers/trace';

// A pálya, a szakaszok és a vezetések a közös fixtúrákból (packages/core/fixtures) – a Swift-port is ezeket futtatja.
const fx = loadSections();
const course = { section: fx.course, leadInM: fx.leadInM };
const L = course.section.lengthM;
const IN = course.leadInM;

function run(sections: Section[], fs: GpsFix[]) {
  const tracker = new SectionTracker(sections);
  const snaps: TrackerSnapshot[] = [];
  for (const f of fs) snaps.push(tracker.update(f));
  const states: TrackerState[] = [];
  for (const s of snaps) for (const tr of s.transitions) states.push(tr.to);
  return { tracker, snaps, states, last: snaps[snaps.length - 1]! };
}

/** A legutolsó, adott pálya menti pozíció előtti snapshot. */
function snapAt(samples: DriveSample[], snaps: TrackerSnapshot[], s: number): TrackerSnapshot {
  const kept = samples.filter((x) => !x.dropped);
  let idx = 0;
  while (idx + 1 < kept.length && kept[idx + 1]!.s <= s) idx++;
  return snaps[idx]!;
}

describe('SectionTracker – normál áthaladás', () => {
  const samples = loadDrive('normal-120');
  const { states, last, snaps } = run([course.section], fixes(samples));

  it('állapotok: kozeledik → szakaszon → kesz', () => {
    expect(states).toEqual(['kozeledik', 'szakaszon', 'kesz']);
    expect(last.state).toBe('kesz');
  });

  it('a közeledés ~2 km-rel a kezdőpont előtt indul', () => {
    const i = snaps.findIndex((s) => s.state === 'kozeledik');
    const s = samples.filter((x) => !x.dropped)[i]!.s;
    expect(IN - s).toBeGreaterThan(1900);
    expect(IN - s).toBeLessThanOrEqual(2000);
  });

  it('az átlag 120 km/h (±0,5)', () => {
    expect(last.lastResult!.averageKmh).toBeCloseTo(120, 0);
    expect(Math.abs(last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
    expect(last.lastResult!.overLimit).toBe(false);
  });

  it('belépési és kilépési idő a valódi időhöz képest < 0,3 s', () => {
    const r = last.lastResult!;
    expect(Math.abs(r.entryTime - trueTimeAt(samples, IN))).toBeLessThan(300);
    expect(Math.abs(r.exitTime - trueTimeAt(samples, IN + L))).toBeLessThan(300);
  });

  it('szakaszon az élő átlag ≈ 120, a megengedett sebesség ≥ 130', () => {
    const mid = snapAt(samples, snaps, IN + 5000);
    expect(mid.state).toBe('szakaszon');
    expect(mid.live!.averageKmh!).toBeGreaterThan(118);
    expect(mid.live!.averageKmh!).toBeLessThan(122);
    expect(mid.live!.distanceM).toBeGreaterThan(4950);
    expect(mid.live!.distanceM).toBeLessThan(5050);
    expect(mid.live!.required.kind).toBe('ok');
    if (mid.live!.required.kind === 'ok') expect(mid.live!.required.maxKmh).toBeGreaterThan(130);
    expect(mid.live!.slowDownKmh).toBe(0);
    expect(mid.live!.estimated).toBe(false);
  });

  it('a kész állapot a megtartási idő után nincs_szakasz-ra vált', () => {
    const tracker = new SectionTracker([course.section]);
    for (const f of fixes(samples)) tracker.update(f);
    const lastFix = samples[samples.length - 1]!.fix;
    const s = tracker.update({ ...lastFix, timestamp: lastFix.timestamp + 61_000 });
    expect(s.state).toBe('nincs_szakasz');
    expect(s.lastResult).not.toBeNull();
  });
});

describe('SectionTracker – gyorsítás a végén', () => {
  // 8 km 125 km/h, majd az utolsó 2 km 160 km/h → átlag ≈ 130,72 km/h
  const samples = loadDrive('accel-125-160');
  const { last, snaps } = run([course.section], fixes(samples));

  it('a végeredmény határ feletti', () => {
    const expected = 10 / (8 / 125 + 2 / 160);
    expect(last.lastResult!.averageKmh).toBeCloseTo(expected, 0);
    expect(last.lastResult!.overLimit).toBe(true);
  });

  it('8 km után ≈ 154,8 km/h a megengedett, 160-nál ≈ 5 km/h-t kell lassítani', () => {
    const snap = snapAt(samples, snaps, IN + 8100);
    const req = snap.live!.required;
    expect(req.kind).toBe('ok');
    if (req.kind === 'ok') expect(req.maxKmh).toBeGreaterThan(152);
    expect(snap.live!.slowDownKmh!).toBeGreaterThan(3);
    expect(snap.live!.slowDownKmh!).toBeLessThan(10);
  });

  it('végig 160 km/h-val a végén "nem lehetséges"', () => {
    const fast = loadDrive('const-160');
    const r = run([course.section], fixes(fast));
    const snap = snapAt(fast, r.snaps, IN + 9300);
    expect(snap.live!.required.kind).toBe('nem_lehetseges');
    expect(r.last.lastResult!.averageKmh).toBeCloseTo(160, 0);
  });

  it('a "nem lehetséges" küszöb a határ 60%-a (130 → 78 km/h), és konfigurálható', () => {
    // 160 km/h mellett a megengedett sebesség ≈ 7,8 km-nél esik 78 km/h alá (60 km/h alá csak ≈ 8,6 km-nél)
    const fast = loadDrive('const-160');
    const def = run([course.section], fixes(fast));
    expect(snapAt(fast, def.snaps, IN + 7600).live!.required.kind).toBe('ok');
    expect(snapAt(fast, def.snaps, IN + 8200).live!.required.kind).toBe('nem_lehetseges');
    const t = new SectionTracker([course.section], { minPracticalFraction: 60 / 130 });
    const snaps = fixes(fast).map((f) => t.update(f));
    expect(snapAt(fast, snaps, IN + 8200).live!.required.kind).toBe('ok');
  });
});

describe('SectionTracker – alagút és GPS-ugrás', () => {
  // 2 km kiesés a kanyar közepén (az egyenes húr itt alábecsülné az utat)
  const samples = loadDrive('tunnel-120');
  const fs = fixes(samples);
  const { states, last, tracker } = run([course.section], fs);

  it('nem szakad meg, és az átlag pontos', () => {
    expect(states).toEqual(['kozeledik', 'szakaszon', 'kesz']);
    expect(Math.abs(last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
  });

  it('kiesés közben becsül (dead reckoning)', () => {
    const t2 = new SectionTracker([course.section]);
    const before = samples.filter((x) => !x.dropped && x.s < IN + 5000);
    for (const x of before) t2.update(x.fix);
    const lastBefore = before[before.length - 1]!;
    const now = lastBefore.t + 30_000;
    const snap = t2.tick(now);
    expect(snap.state).toBe('szakaszon');
    expect(snap.live!.estimated).toBe(true);
    const trueDist = lastBefore.s - IN + (120 / 3.6) * 30;
    expect(Math.abs(snap.live!.distanceM - trueDist)).toBeLessThan(50);
    expect(snap.live!.averageKmh!).toBeCloseTo(120, -1);
  });

  it('túl hosszú kiesés → megszakadt (jelvesztes)', () => {
    const t3 = new SectionTracker([course.section], { maxGapMs: 60_000 });
    const before = samples.filter((x) => !x.dropped && x.s < IN + 3000);
    for (const x of before) t3.update(x.fix);
    const snap = t3.tick(before[before.length - 1]!.t + 61_000);
    expect(snap.state).toBe('megszakadt');
    expect(snap.abortReason).toBe('jelvesztes');
  });

  it('a pontatlan (nagy accuracy) fixek nem rontják az eredményt', () => {
    const noisy = fs.map((f, i) => (i % 7 === 0 ? { ...f, lat: f.lat + 0.01, accuracy: 300 } : f));
    const r = run([course.section], noisy);
    expect(r.last.state).toBe('kesz');
    expect(Math.abs(r.last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
  });

  it('a tracker nyilvános állapota is kesz', () => {
    expect(tracker.currentState).toBe('kesz');
  });
});

describe('SectionTracker – ellenirány', () => {
  it('az ellenirányú pályán (25 m-re) nem lép be', () => {
    // A másik pálya: a teljes útvonal megfordítva, a menetiránytól jobbra 25 m-rel
    const samples = loadDrive('opposite-25m-noise3');
    const { states, snaps } = run([course.section], fixes(samples));
    expect(states).toEqual([]);
    expect(snaps.every((s) => s.state === 'nincs_szakasz')).toBe(true);
  });

  it('irányszög nélkül is (csak a pozíciókból) kiszűri', () => {
    const samples = loadDrive('opposite-25m');
    const fs = fixes(samples).map((f) => ({ ...f, heading: null, speed: null }));
    expect(run([course.section], fs).states).toEqual([]);
  });

  it('irányszög nélkül a helyes irányban belép', () => {
    const samples = loadDrive('clean-120');
    const fs = fixes(samples).map((f) => ({ ...f, heading: null, speed: null }));
    const r = run([course.section], fs);
    expect(r.states).toEqual(['kozeledik', 'szakaszon', 'kesz']);
    expect(Math.abs(r.last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
  });
});

describe('SectionTracker – párhuzamos út és letérés', () => {
  it('a 150 m-re futó párhuzamos úton nem lép be', () => {
    const samples = loadDrive('parallel-150m');
    const { states } = run([course.section], fixes(samples));
    expect(states).not.toContain('szakaszon');
    expect(states).toEqual([]);
  });

  it('a 60 m-re futó szervizúton közeledést jelezhet, de nem lép be', () => {
    const samples = loadDrive('parallel-60m');
    const { states, last } = run([course.section], fixes(samples));
    expect(states).not.toContain('szakaszon');
    expect(last.state).toBe('nincs_szakasz');
  });

  it('letérés a szakasz közepén → megszakadt (letert)', () => {
    // 4 km után kihajt kelet felé
    const samples = loadDrive('exit-at-4km');
    const { states, last } = run([course.section], fixes(samples));
    // a megszakadt állapot 60 s-ig látszik, utána nincs_szakasz
    expect(states).toEqual(['kozeledik', 'szakaszon', 'megszakadt', 'nincs_szakasz']);
    expect(last.abortReason).toBe('letert');
    expect(last.lastResult).toBeNull();
  });
});

describe('SectionTracker – speciális esetek', () => {
  it('egymás utáni szakaszok: kesz után azonnal szakaszon', () => {
    const first = course.section;
    const second: Section = fx.second;
    const samples = loadDrive('consecutive-110');
    const { states, last } = run([first, second], fixes(samples));
    expect(states).toEqual(['kozeledik', 'szakaszon', 'kesz', 'szakaszon', 'kesz']);
    expect(last.lastResult!.sectionId).toBe('TEST-2');
    expect(last.lastResult!.averageKmh).toBeCloseTo(110, 0);
  });

  it('dugó: 2 perc állás a szakaszon (zajos fixekkel) nem szakítja meg', () => {
    const samples = loadDrive('jam-100');
    const { states, last } = run([course.section], fixes(samples));
    expect(states.slice(0, 3)).toEqual(['kozeledik', 'szakaszon', 'kesz']);
    const r = last.lastResult!;
    const expected = (L / ((trueTimeAt(samples, IN + L) - trueTimeAt(samples, IN)) / 1000)) * 3.6;
    expect(Math.abs(r.averageKmh - expected)).toBeLessThan(0.5);
    expect(r.averageKmh).toBeLessThan(80);
  });

  it('az app a kapuzónán belül indul: belép, a belépési idő visszaszámolt', () => {
    const samples = loadDrive('clean-120');
    const fs = fixes(samples).filter((_, i) => samples[i]!.s >= IN + 50);
    const { states, last } = run([course.section], fs);
    expect(states[0]).toBe('szakaszon');
    expect(Math.abs(last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
  });

  it('kapuzónán túl indulva nem lép be (nincs megbízható kezdés)', () => {
    const samples = loadDrive('clean-120');
    const fs = fixes(samples).filter((_, i) => samples[i]!.s >= IN + 1000);
    expect(run([course.section], fs).states).toEqual([]);
  });

  it('geometria nélküli (egyenes) szakasz is működik', () => {
    const straight: Section = fx.straight;
    const samples = loadDrive('straight-130');
    const { last } = run([straight], fixes(samples));
    expect(last.lastResult!.averageKmh).toBeCloseTo(130, 0);
  });

  it('setSections menet közben: a futó mérés megmarad, az új szakaszok felismerhetők', () => {
    const samples = loadDrive('clean-120');
    const fs = fixes(samples);
    const t = new SectionTracker([]);
    const half = Math.floor(fs.length / 2);
    for (const f of fs.slice(0, 50)) t.update(f);
    expect(t.currentState).toBe('nincs_szakasz');
    t.setSections([course.section]); // a szerverről megjött a szakasz
    for (const f of fs.slice(50, half)) t.update(f);
    expect(t.currentState).toBe('szakaszon');
    // újabb frissítés (új objektumok, plusz egy másik szakasz) – nem szakíthatja meg
    t.setSections([{ ...course.section }, { ...course.section, id: 'MASIK', start: fx.farStart }]);
    let last = t.snapshot(0);
    for (const f of fs.slice(half)) last = t.update(f);
    expect(last.lastResult?.sectionId).toBe('TEST-1');
    expect(Math.abs(last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
  });

  it('reset után tiszta állapot', () => {
    const t = new SectionTracker([course.section]);
    for (const f of fixes(loadDrive('clean-120')).slice(0, 150)) t.update(f);
    expect(t.currentState).toBe('szakaszon');
    t.reset();
    expect(t.snapshot(0)).toMatchObject({ state: 'nincs_szakasz', section: null, live: null, lastResult: null });
  });
});

describe('SectionTracker – robusztusság', () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('8 m GPS-zaj, seed %i: kész, átlag ±0,5 km/h', (seed) => {
    const samples = loadDrive(`robust-seed-${String(seed).padStart(2, '0')}`);
    const { last } = run([course.section], fixes(samples));
    expect(last.lastResult).not.toBeNull();
    const expected = (L / ((trueTimeAt(samples, IN + L) - trueTimeAt(samples, IN)) / 1000)) * 3.6;
    expect(Math.abs(last.lastResult!.averageKmh - expected)).toBeLessThan(0.5);
  });
});
