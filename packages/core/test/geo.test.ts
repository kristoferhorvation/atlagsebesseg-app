import { describe, expect, it } from 'vitest';
import { angleDiffDeg, bearingDeg, haversineM, LocalProjection, polylineLengthM } from '../src/geo';

describe('geo', () => {
  it('haversine: 1 fok szélesség ≈ 111,2 km', () => {
    expect(haversineM({ lat: 45, lon: 10 }, { lat: 46, lon: 10 })).toBeCloseTo(111_195, -1);
  });

  it('haversine: Bologna–Firenze légvonal ≈ 81 km', () => {
    const d = haversineM({ lat: 44.4949, lon: 11.3426 }, { lat: 43.7696, lon: 11.2558 });
    expect(d / 1000).toBeGreaterThan(80);
    expect(d / 1000).toBeLessThan(82);
  });

  it('irányszög: észak, kelet, dél, nyugat', () => {
    const o = { lat: 45, lon: 10 };
    expect(bearingDeg(o, { lat: 45.1, lon: 10 })).toBeCloseTo(0, 5);
    expect(bearingDeg(o, { lat: 45, lon: 10.1 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 44.9, lon: 10 })).toBeCloseTo(180, 5);
    expect(bearingDeg(o, { lat: 45, lon: 9.9 })).toBeCloseTo(270, 0);
  });

  it('szögkülönbség átfordulással', () => {
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(10, 350)).toBe(20);
    expect(angleDiffDeg(0, 180)).toBe(180);
    expect(angleDiffDeg(-90, 270)).toBe(0);
  });

  it('helyi vetület oda-vissza', () => {
    const p = new LocalProjection({ lat: 44.5, lon: 11.3 });
    const back = p.fromXY(p.toXY({ lat: 44.53, lon: 11.37 }));
    expect(back.lat).toBeCloseTo(44.53, 9);
    expect(back.lon).toBeCloseTo(11.37, 9);
    const xy = p.toXY({ lat: 44.5, lon: 11.4 });
    expect(xy.x).toBeCloseTo(haversineM({ lat: 44.5, lon: 11.3 }, { lat: 44.5, lon: 11.4 }), -1);
  });

  it('polyline hossza', () => {
    expect(polylineLengthM([{ lat: 45, lon: 10 }, { lat: 45.5, lon: 10 }, { lat: 46, lon: 10 }])).toBeCloseTo(111_195, -1);
  });
});
