import { describe, expect, it } from 'vitest';
import { heatGeo } from './heatGeo';

// AW20: a hőtérkép H3-műveletei – a Swift-pár: AtlagsebessegTests/HeatTests.swift (SwiftyH3), azonos értékekkel
describe('H3 (hőtérkép)', () => {
  it('a hőtérkép H3-műveletei: középpont és szülő-cella ugyanaz, mint a SwiftyH3-ban', async () => {
    const geo = (await heatGeo())!;
    const cell = geo.cellOf(47.4979, 19.0402)!;
    expect(cell).toBe('8a1e03785377fff');
    const c = geo.center(cell);
    expect(c.lat).toBeCloseTo(47.49801, 4);
    expect(c.lon).toBeCloseTo(19.04057, 4);
    expect(geo.parent(cell, 8)).toBe('881e037853fffff');
    expect(geo.cellOf(Number.NaN, 19)).toBeNull();
  });
});
