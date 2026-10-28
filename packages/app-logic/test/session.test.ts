import { describe, expect, it } from 'vitest';
import { drive, fixes, testCourse, toLatLon } from '@atlagsebesseg/core/test/helpers/trace';
import { TrackingSession, type SessionPhase } from '../src/session';

/** Végigvezet a tesztpályán (rávezető + 10 km-es szakasz + kivezető) állandó sebességgel. */
function run(speedKmh: number) {
  const course = testCourse();
  const samples = fixes(drive({ path: toLatLon(course.fullXY), speedKmh: () => speedKmh }));
  return { course, samples };
}

describe('TrackingSession', () => {
  it('közeledés → mérés → befejezve, a színkóddal', () => {
    const { course, samples } = run(120);
    let t = samples[0]!.timestamp;
    const session = new TrackingSession([course.section], { now: () => t });
    const phases = new Set<SessionPhase>();
    let measuring = null as ReturnType<TrackingSession['view']> | null;
    for (const f of samples) {
      t = f.timestamp;
      const v = session.onFix(f);
      phases.add(v.phase);
      if (v.phase === 'meres' && v.progress! > 0.5 && !measuring) measuring = v;
      if (v.phase === 'kozeledik') expect(v.approachM).toBeGreaterThan(0);
    }
    expect([...phases]).toEqual(expect.arrayContaining(['nincs_szakasz', 'kozeledik', 'meres', 'befejezve']));
    expect(measuring!.status).toBe('jo');
    const end = session.view();
    expect(end.phase).toBe('befejezve');
    expect(end.result!.averageKmh).toBeCloseTo(120, 0);
    expect(session.dismiss().phase).toBe('nincs_szakasz');
  });

  it('a színkód a várható végső átlagból jön, nem a pillanatnyiból', () => {
    // 5 km 150-nel, aztán 100-zal (határ 130): 6 km-nél a pillanatnyi átlag ~138, a várható végső ~120
    const course = testCourse();
    const L = course.section.lengthM;
    const speed = (s: number) => (s < course.leadInM + L / 2 ? 150 : 100);
    const samples = fixes(drive({ path: toLatLon(course.fullXY), speedKmh: speed }));
    let t = 0;
    const session = new TrackingSession([course.section], { now: () => t });
    let at60 = null as ReturnType<TrackingSession['view']> | null;
    for (const f of samples) {
      t = f.timestamp;
      const v = session.onFix(f);
      if (v.phase === 'meres' && v.progress! > 0.6 && !at60) at60 = v;
    }
    expect(at60!.live!.averageKmh!).toBeGreaterThan(130);
    expect(at60!.live!.projectedKmh!).toBeLessThan(125);
    expect(at60!.status).toBe('lassits'); // átlag a határ felett, de a várható végső alatta
  });

  it('határ felett: tul', () => {
    const { course, samples } = run(140);
    let t = 0;
    const session = new TrackingSession([course.section], { now: () => t });
    for (const f of samples) {
      t = f.timestamp;
      session.onFix(f);
    }
    expect(session.view()).toMatchObject({ phase: 'befejezve', status: 'tul_gyors' });
  });

  it('háttérbe kerülés mérés közben: megszakadt, nincs átlag, és nem folytatódik', () => {
    const { course, samples } = run(110);
    let t = 0;
    const session = new TrackingSession([course.section], { now: () => t });
    let i = 0;
    for (; i < samples.length; i++) {
      t = samples[i]!.timestamp;
      if (session.onFix(samples[i]!).progress! > 0.3) break;
    }
    const v = session.interrupt('hatter');
    expect(v).toMatchObject({ phase: 'megszakadt', live: null, interruption: { reason: 'hatter' } });
    expect(v.section!.id).toBe(course.section.id);
    // visszatérés a szakasz közepén: nincs új mérés, és nincs hamis eredmény
    for (const f of samples.slice(i + 30)) {
      t = f.timestamp;
      const w = session.onFix(f);
      expect(w.phase).not.toBe('meres');
      expect(w.phase).not.toBe('befejezve');
    }
    t += 61_000;
    expect(session.tick().phase).toBe('nincs_szakasz');
  });

  it('kézi mód: indítás, átlag, leállítás után eredmény; háttérben megszakad', () => {
    const { samples } = run(90);
    let t = samples[0]!.timestamp;
    const session = new TrackingSession([], { now: () => t });
    expect(session.startManual().phase).toBe('kezi');
    for (const f of samples.slice(0, 120)) {
      t = f.timestamp;
      session.onFix(f);
    }
    expect(session.view().manual!.averageKmh).toBeCloseTo(90, 0);
    const r = session.stopManual();
    expect(r.phase).toBe('kezi_eredmeny');
    expect(r.manualResult!.gates).not.toBeNull();
    session.startManual();
    expect(session.interrupt().phase).toBe('megszakadt');
  });
});
