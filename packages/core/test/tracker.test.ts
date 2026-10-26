import { describe, expect, it } from 'vitest';
import { SectionTracker, type TrackerSnapshot, type TrackerState } from '../src/tracker';
import type { GpsFix, Section } from '../src/types';
import {
  concat,
  drive,
  fixes,
  line,
  offset,
  reverseXY,
  testCourse,
  toLatLon,
  trueTimeAt,
  type DriveSample,
} from './helpers/trace';

const course = testCourse();
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
  const samples = drive({ path: toLatLon(course.fullXY), speedKmh: () => 120, noiseM: 4, seed: 7 });
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
  const samples = drive({
    path: toLatLon(course.fullXY),
    speedKmh: (s) => (s < IN + 8000 ? 125 : 160),
  });
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
    const fast = drive({ path: toLatLon(course.fullXY), speedKmh: () => 160 });
    const r = run([course.section], fixes(fast));
    const snap = snapAt(fast, r.snaps, IN + 9300);
    expect(snap.live!.required.kind).toBe('nem_lehetseges');
    expect(r.last.lastResult!.averageKmh).toBeCloseTo(160, 0);
  });
});

describe('SectionTracker – alagút és GPS-ugrás', () => {
  // 2 km kiesés a kanyar közepén (az egyenes húr itt alábecsülné az utat)
  const samples = drive({
    path: toLatLon(course.fullXY),
    speedKmh: () => 120,
    noiseM: 4,
    seed: 3,
    dropRanges: [[IN + 5000, IN + 7000]],
    jumpAt: [200, 201, 330],
  });
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
    const opposite = offset(reverseXY(course.fullXY), 25);
    const samples = drive({ path: toLatLon(opposite), speedKmh: () => 120, noiseM: 3 });
    const { states, snaps } = run([course.section], fixes(samples));
    expect(states).toEqual([]);
    expect(snaps.every((s) => s.state === 'nincs_szakasz')).toBe(true);
  });

  it('irányszög nélkül is (csak a pozíciókból) kiszűri', () => {
    const opposite = offset(reverseXY(course.fullXY), 25);
    const samples = drive({ path: toLatLon(opposite), speedKmh: () => 120 });
    const fs = fixes(samples).map((f) => ({ ...f, heading: null, speed: null }));
    expect(run([course.section], fs).states).toEqual([]);
  });

  it('irányszög nélkül a helyes irányban belép', () => {
    const samples = drive({ path: toLatLon(course.fullXY), speedKmh: () => 120 });
    const fs = fixes(samples).map((f) => ({ ...f, heading: null, speed: null }));
    const r = run([course.section], fs);
    expect(r.states).toEqual(['kozeledik', 'szakaszon', 'kesz']);
    expect(Math.abs(r.last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
  });
});

describe('SectionTracker – párhuzamos út és letérés', () => {
  it('a 150 m-re futó párhuzamos úton nem lép be', () => {
    const parallel = offset(course.fullXY, 150);
    const samples = drive({ path: toLatLon(parallel), speedKmh: () => 90, noiseM: 4 });
    const { states } = run([course.section], fixes(samples));
    expect(states).not.toContain('szakaszon');
    expect(states).toEqual([]);
  });

  it('a 60 m-re futó szervizúton közeledést jelezhet, de nem lép be', () => {
    const parallel = offset(course.fullXY, 60);
    const samples = drive({ path: toLatLon(parallel), speedKmh: () => 90 });
    const { states, last } = run([course.section], fixes(samples));
    expect(states).not.toContain('szakaszon');
    expect(last.state).toBe('nincs_szakasz');
  });

  it('letérés a szakasz közepén → megszakadt (letert)', () => {
    // 4 km után kihajt kelet felé
    const exitPath = concat(course.leadIn, line({ x: 0, y: 0 }, { x: 0, y: 4000 }), line({ x: 0, y: 4000 }, { x: 150, y: 4300 }), line({ x: 150, y: 4300 }, { x: 2000, y: 4400 }));
    const samples = drive({ path: toLatLon(exitPath), speedKmh: () => 100, noiseM: 3 });
    const { states, last } = run([course.section], fixes(samples));
    // a megszakadt állapot 60 s-ig látszik, utána nincs_szakasz
    expect(states).toEqual(['kozeledik', 'szakaszon', 'megszakadt', 'nincs_szakasz']);
    expect(last.abortReason).toBe('letert');
    expect(last.lastResult).toBeNull();
  });
});

describe('SectionTracker – speciális esetek', () => {
  it('egymás utáni szakaszok: kesz után azonnal szakaszon', () => {
    const R = 3000;
    const first = course.section;
    const endXY = course.sectionXY[course.sectionXY.length - 1]!;
    const nextXY = line(endXY, { x: endXY.x + 5000, y: endXY.y });
    const nextPts = toLatLon(nextXY);
    const second: Section = {
      ...first,
      id: 'TEST-2',
      start: nextPts[0]!,
      end: nextPts[nextPts.length - 1]!,
      lengthM: 5000,
      geometry: nextPts,
    };
    const path = toLatLon(concat(course.leadIn, course.sectionXY, nextXY, line({ x: endXY.x + 5000, y: endXY.y }, { x: endXY.x + 6000, y: endXY.y })));
    const samples = drive({ path, speedKmh: () => 110 });
    const { states, last } = run([first, second], fixes(samples));
    expect(states).toEqual(['kozeledik', 'szakaszon', 'kesz', 'szakaszon', 'kesz']);
    expect(last.lastResult!.sectionId).toBe('TEST-2');
    expect(last.lastResult!.averageKmh).toBeCloseTo(110, 0);
    void R;
  });

  it('dugó: 2 perc állás a szakaszon (zajos fixekkel) nem szakítja meg', () => {
    const samples = drive({
      path: toLatLon(course.fullXY),
      speedKmh: () => 100,
      pauses: [{ atS: IN + 3000, durationMs: 120_000 }],
      noiseM: 6,
      seed: 11,
    });
    const { states, last } = run([course.section], fixes(samples));
    expect(states.slice(0, 3)).toEqual(['kozeledik', 'szakaszon', 'kesz']);
    const r = last.lastResult!;
    const expected = (L / ((trueTimeAt(samples, IN + L) - trueTimeAt(samples, IN)) / 1000)) * 3.6;
    expect(Math.abs(r.averageKmh - expected)).toBeLessThan(0.5);
    expect(r.averageKmh).toBeLessThan(80);
  });

  it('az app a kapuzónán belül indul: belép, a belépési idő visszaszámolt', () => {
    const samples = drive({ path: toLatLon(course.fullXY), speedKmh: () => 120 });
    const fs = fixes(samples).filter((_, i) => samples[i]!.s >= IN + 50);
    const { states, last } = run([course.section], fs);
    expect(states[0]).toBe('szakaszon');
    expect(Math.abs(last.lastResult!.averageKmh - 120)).toBeLessThan(0.5);
  });

  it('kapuzónán túl indulva nem lép be (nincs megbízható kezdés)', () => {
    const samples = drive({ path: toLatLon(course.fullXY), speedKmh: () => 120 });
    const fs = fixes(samples).filter((_, i) => samples[i]!.s >= IN + 1000);
    expect(run([course.section], fs).states).toEqual([]);
  });

  it('geometria nélküli (egyenes) szakasz is működik', () => {
    const pts = toLatLon(line({ x: 0, y: 0 }, { x: 0, y: 6000 }));
    const straight: Section = { ...course.section, id: 'S', geometry: undefined, start: pts[0]!, end: pts[pts.length - 1]!, lengthM: 6000 };
    const path = toLatLon(line({ x: 0, y: -2500 }, { x: 0, y: 7000 }));
    const samples = drive({ path, speedKmh: () => 130 });
    const { last } = run([straight], fixes(samples));
    expect(last.lastResult!.averageKmh).toBeCloseTo(130, 0);
  });

  it('reset után tiszta állapot', () => {
    const t = new SectionTracker([course.section]);
    for (const f of fixes(drive({ path: toLatLon(course.fullXY), speedKmh: () => 120 })).slice(0, 150)) t.update(f);
    expect(t.currentState).toBe('szakaszon');
    t.reset();
    expect(t.snapshot(0)).toMatchObject({ state: 'nincs_szakasz', section: null, live: null, lastResult: null });
  });
});

describe('SectionTracker – robusztusság', () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('8 m GPS-zaj, seed %i: kész, átlag ±0,5 km/h', (seed) => {
    const samples = drive({ path: toLatLon(course.fullXY), speedKmh: (s) => 110 + 15 * Math.sin(s / 700), noiseM: 8, accuracy: 10, seed });
    const { last } = run([course.section], fixes(samples));
    expect(last.lastResult).not.toBeNull();
    const expected = (L / ((trueTimeAt(samples, IN + L) - trueTimeAt(samples, IN)) / 1000)) * 3.6;
    expect(Math.abs(last.lastResult!.averageKmh - expected)).toBeLessThan(0.5);
  });
});
