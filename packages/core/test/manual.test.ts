import { describe, expect, it } from 'vitest';
import { ManualTracker } from '../src/manual';
import { loadDrive } from './helpers/fixtures';
import { fixes } from './helpers/trace';

describe('ManualTracker – kézi mód', () => {
  // 5 km: 3 km egyenes + 2 km-es enyhe ív (a vezetések a közös fixtúrákból)

  it('a GPS-útból számolja a hosszt és az átlagot', () => {
    const samples = loadDrive('manual-noise3');
    const m = new ManualTracker();
    m.start(samples[0]!.t - 2000);
    for (const f of fixes(samples)) m.addFix(f);
    const r = m.stop(samples[samples.length - 1]!.t + 1000);
    expect(r.running).toBe(false);
    expect(Math.abs(r.distanceM - 5000) / 5000).toBeLessThan(0.01);
    expect(Math.abs(r.averageKmh! - 100)).toBeLessThan(1);
    // kapuk: az első és az utolsó pont, haladási iránnyal (indulás észak felé, a végén az íven kelet felé fordulva)
    expect(r.gates).not.toBeNull();
    expect(r.gates!.start.timestamp).toBe(fixes(samples)[0]!.timestamp);
    expect(r.gates!.start.headingDeg!).toBeCloseTo(0, -1);
    expect(r.gates!.end.headingDeg!).toBeGreaterThan(20);
    expect(r.gates!.end.headingDeg!).toBeLessThan(40);
  });

  it('irányszög nélküli fixekből is ad kapu-irányt', () => {
    const samples = loadDrive('manual-clean');
    const m = new ManualTracker();
    m.start(samples[0]!.t);
    for (const f of fixes(samples)) m.addFix({ ...f, heading: null });
    const r = m.stop(samples[samples.length - 1]!.t);
    expect(Math.min(r.gates!.start.headingDeg!, 360 - r.gates!.start.headingDeg!)).toBeLessThan(2);
    expect(r.gates!.end.headingDeg!).toBeGreaterThan(20);
  });

  it('adat nélkül nincs kapu', () => {
    const m = new ManualTracker();
    m.start(0);
    expect(m.stop(1000).gates).toBeNull();
  });

  it('alagút az egyenesen: a kiesést egyenessel becsüli', () => {
    const samples = loadDrive('manual-tunnel');
    const m = new ManualTracker();
    m.start(samples[0]!.t);
    for (const f of fixes(samples)) m.addFix(f);
    const r = m.stop(samples[samples.length - 1]!.t);
    expect(r.estimatedGapM).toBeGreaterThan(1400);
    expect(Math.abs(r.distanceM - 5000) / 5000).toBeLessThan(0.01);
    expect(Math.abs(r.averageKmh! - 100)).toBeLessThan(1);
  });

  it('GPS-ugrás és pontatlan fix nem növeli az utat', () => {
    const samples = loadDrive('manual-jumps');
    const m = new ManualTracker();
    m.start(samples[0]!.t);
    for (const [i, f] of fixes(samples).entries()) m.addFix(i === 60 ? { ...f, lon: f.lon + 0.02, accuracy: 200 } : f);
    const r = m.stop(samples[samples.length - 1]!.t);
    expect(Math.abs(r.distanceM - 5000) / 5000).toBeLessThan(0.01);
  });

  it('álló helyzetben a zaj nem halmozódik', () => {
    const samples = loadDrive('manual-standing');
    const m = new ManualTracker();
    m.start(samples[0]!.t);
    const standing = fixes(samples).filter((_, i) => samples[i]!.s < 10).slice(0, 120);
    for (const f of standing) m.addFix(f);
    expect(m.snapshot().distanceM).toBeLessThan(30);
  });

  it('indítás előtt és leállítás után nem mér', () => {
    const samples = loadDrive('manual-clean');
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
