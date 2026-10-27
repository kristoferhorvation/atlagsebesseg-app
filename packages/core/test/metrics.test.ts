import { describe, expect, it } from 'vitest';
import { averageSpeedKmh, limitWithToleranceKmh, projectedAverageKmh, requiredSpeed, slowDownByKmh, toleranceKmh } from '../src/metrics';

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
    if (r.kind === 'nem_lehetseges') expect(r.maxKmh).toBeLessThan(130 * 0.6);
  });

  it('a minimum-küszöb állítható (a határ hányadaként)', () => {
    const r = requiredSpeed({ ...base, distanceDoneM: 9000, elapsedMs: (9 / 160) * 3_600_000, minPracticalFraction: 0.3 });
    expect(r.kind).toBe('ok');
  });

  it('a küszöb a határ 60%-a: 130-nál 78, 100-nál 60 km/h', () => {
    // a hátralévő 2 km-en legfeljebb 70 km/h
    const at = (limit: number) => {
      const L = 10_000;
      const budgetS = 2000 / (70 / 3.6);
      const elapsedMs = (L / (limit / 3.6) - budgetS) * 1000;
      return requiredSpeed({ lengthM: L, speedLimitKmh: limit, distanceDoneM: 8000, elapsedMs });
    };
    expect(at(130)).toMatchObject({ kind: 'nem_lehetseges' });
    expect(at(100)).toMatchObject({ kind: 'ok' });
    const r = at(130);
    if (r.kind !== 'nincs_korlat') expect(r.maxKmh).toBeCloseTo(70, 6);
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

describe('tűrés', () => {
  it('5% vagy 5 km/h, a nagyobb', () => {
    expect(toleranceKmh(130)).toBeCloseTo(6.5, 9);
    expect(toleranceKmh(100)).toBe(5);
    expect(toleranceKmh(80)).toBe(5);
    expect(toleranceKmh(50)).toBe(5);
    expect(limitWithToleranceKmh(130)).toBeCloseTo(136.5, 9);
    expect(limitWithToleranceKmh(110)).toBeCloseTo(115.5, 9);
    expect(limitWithToleranceKmh(90)).toBe(95);
  });

  it('a szabály paraméterezhető', () => {
    expect(toleranceKmh(130, { percent: 3, minKmh: 3 })).toBeCloseTo(3.9, 9);
    expect(limitWithToleranceKmh(60, { percent: 0, minKmh: 0 })).toBe(60);
  });

  it('a szükséges sebesség a tűréstől független (mindig a szigorú határ)', () => {
    const r = requiredSpeed({ lengthM: 10_000, speedLimitKmh: 130, distanceDoneM: 0, elapsedMs: 0 });
    expect(r).toEqual({ kind: 'ok', maxKmh: 130 });
  });
});

describe('projectedAverageKmh', () => {
  const L = 10_000;
  it('állandó sebességnél a végső átlag a jelenlegi átlag', () => {
    const v = projectedAverageKmh({ lengthM: L, distanceDoneM: 4000, elapsedMs: (4 / 120) * 3_600_000, currentKmh: 120 });
    expect(v).toBeCloseTo(120, 6);
  });
  it('gyors kezdés után lassítva a végső átlag a pillanatnyi alá esik', () => {
    // 5 km 150-nel, onnan 100-zal: 10 / (5/150 + 5/100) = 120
    const v = projectedAverageKmh({ lengthM: L, distanceDoneM: 5000, elapsedMs: (5 / 150) * 3_600_000, currentKmh: 100 });
    expect(v).toBeCloseTo(120, 6);
  });
  it('sebesség nélkül vagy állva null; célban a tényleges átlag', () => {
    expect(projectedAverageKmh({ lengthM: L, distanceDoneM: 1000, elapsedMs: 30_000, currentKmh: null })).toBeNull();
    expect(projectedAverageKmh({ lengthM: L, distanceDoneM: 1000, elapsedMs: 30_000, currentKmh: 0.5 })).toBeNull();
    expect(projectedAverageKmh({ lengthM: L, distanceDoneM: L, elapsedMs: 300_000, currentKmh: 0 })).toBeCloseTo(120, 6);
  });
});
