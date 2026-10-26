import { describe, expect, it } from 'vitest';
import { ManualTracker } from '../src/manual';
import { arc, concat, drive, fixes, line, toLatLon } from './helpers/trace';

describe('ManualTracker – kézi mód', () => {
  // 5 km: 3 km egyenes + 2 km-es enyhe ív
  const R = 4000;
  const path = toLatLon(
    concat(line({ x: 0, y: 0 }, { x: 0, y: 3000 }), arc({ x: R, y: 3000 }, R, Math.PI, Math.PI - 2000 / R)),
  );

  it('a GPS-útból számolja a hosszt és az átlagot', () => {
    const samples = drive({ path, speedKmh: () => 100, noiseM: 3, seed: 5 });
    const m = new ManualTracker();
    m.start(samples[0]!.t - 2000);
    for (const f of fixes(samples)) m.addFix(f);
    const r = m.stop(samples[samples.length - 1]!.t + 1000);
    expect(r.running).toBe(false);
    expect(Math.abs(r.distanceM - 5000) / 5000).toBeLessThan(0.01);
    expect(Math.abs(r.averageKmh! - 100)).toBeLessThan(1);
  });

  it('alagút az egyenesen: a kiesést egyenessel becsüli', () => {
    const samples = drive({ path, speedKmh: () => 100, dropRanges: [[1000, 2500]] });
    const m = new ManualTracker();
    m.start(samples[0]!.t);
    for (const f of fixes(samples)) m.addFix(f);
    const r = m.stop(samples[samples.length - 1]!.t);
    expect(r.estimatedGapM).toBeGreaterThan(1400);
    expect(Math.abs(r.distanceM - 5000) / 5000).toBeLessThan(0.01);
    expect(Math.abs(r.averageKmh! - 100)).toBeLessThan(1);
  });

  it('GPS-ugrás és pontatlan fix nem növeli az utat', () => {
    const samples = drive({ path, speedKmh: () => 100, jumpAt: [40, 90] });
    const m = new ManualTracker();
    m.start(samples[0]!.t);
    for (const [i, f] of fixes(samples).entries()) m.addFix(i === 60 ? { ...f, lon: f.lon + 0.02, accuracy: 200 } : f);
    const r = m.stop(samples[samples.length - 1]!.t);
    expect(Math.abs(r.distanceM - 5000) / 5000).toBeLessThan(0.01);
  });

  it('álló helyzetben a zaj nem halmozódik', () => {
    const samples = drive({ path, speedKmh: (s) => (s < 10 ? 0.01 : 100), noiseM: 4, seed: 9 });
    const m = new ManualTracker();
    m.start(samples[0]!.t);
    const standing = fixes(samples).filter((_, i) => samples[i]!.s < 10).slice(0, 120);
    for (const f of standing) m.addFix(f);
    expect(m.snapshot().distanceM).toBeLessThan(30);
  });

  it('indítás előtt és leállítás után nem mér', () => {
    const samples = drive({ path, speedKmh: () => 100 });
    const m = new ManualTracker();
    for (const f of fixes(samples).slice(0, 20)) m.addFix(f);
    expect(m.snapshot().acceptedFixes).toBe(0);
    m.start(samples[20]!.t);
    for (const f of fixes(samples).slice(0, 60)) m.addFix(f);
    expect(m.snapshot().acceptedFixes).toBe(40);
    m.stop(samples[60]!.t);
    m.addFix(samples[70]!.fix);
    expect(m.snapshot().acceptedFixes).toBe(40);
    expect(m.isRunning).toBe(false);
  });
});
