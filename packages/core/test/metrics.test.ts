import { describe, expect, it } from 'vitest';
import { averageSpeedKmh, requiredSpeed, slowDownByKmh } from '../src/metrics';

describe('averageSpeedKmh', () => {
  it('10 km 5 perc alatt = 120 km/h', () => {
    expect(averageSpeedKmh(10_000, 300_000)).toBeCloseTo(120, 9);
  });
  it('nincs adat → null', () => {
    expect(averageSpeedKmh(0, 10_000)).toBeNull();
    expect(averageSpeedKmh(100, 500)).toBeNull();
  });
});

describe('requiredSpeed', () => {
  const base = { lengthM: 10_000, speedLimitKmh: 130 };

  it('az elején a határral egyezik', () => {
    const r = requiredSpeed({ ...base, distanceDoneM: 0, elapsedMs: 0 });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.maxKmh).toBeCloseTo(130, 9);
  });

  it('8 km 125 km/h-val → a maradék 2 km legfeljebb ≈ 154,8 km/h', () => {
    const r = requiredSpeed({ ...base, distanceDoneM: 8000, elapsedMs: (8 / 125) * 3_600_000 });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.maxKmh).toBeCloseTo(154.78, 1);
  });

  it('ha túl gyors voltál, a hátralévő maximum a határ alá esik', () => {
    const r = requiredSpeed({ ...base, distanceDoneM: 5000, elapsedMs: (5 / 150) * 3_600_000 });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.maxKmh).toBeLessThan(130);
  });

  it('nem lehetséges, ha csak irreálisan lassan lehetne a határ alá kerülni', () => {
    const r = requiredSpeed({ ...base, distanceDoneM: 9000, elapsedMs: (9 / 160) * 3_600_000 });
    expect(r.kind).toBe('nem_lehetseges');
    if (r.kind === 'nem_lehetseges') expect(r.maxKmh).toBeLessThan(60);
  });

  it('a minimum-küszöb állítható', () => {
    const r = requiredSpeed({ ...base, distanceDoneM: 9000, elapsedMs: (9 / 160) * 3_600_000, minPracticalKmh: 30 });
    expect(r.kind).toBe('ok');
  });

  it('célba érve határ felett: nem lehetséges', () => {
    expect(requiredSpeed({ ...base, distanceDoneM: 10_000, elapsedMs: 200_000 }).kind).toBe('nem_lehetseges');
  });

  it('ha elég idő eltelt, nincs korlát', () => {
    expect(requiredSpeed({ ...base, distanceDoneM: 5000, elapsedMs: 300_000 }).kind).toBe('nincs_korlat');
  });
});

describe('slowDownByKmh', () => {
  it('a jelenlegi és a megengedett különbsége, alulról 0-ra vágva', () => {
    expect(slowDownByKmh(160, { kind: 'ok', maxKmh: 140 })).toBe(20);
    expect(slowDownByKmh(120, { kind: 'ok', maxKmh: 140 })).toBe(0);
    expect(slowDownByKmh(200, { kind: 'nincs_korlat' })).toBe(0);
    expect(slowDownByKmh(null, { kind: 'ok', maxKmh: 140 })).toBeNull();
  });
});
