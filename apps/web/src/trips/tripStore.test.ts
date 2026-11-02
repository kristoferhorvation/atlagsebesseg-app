import { describe, expect, it } from 'vitest';
import { tripCellFn } from './tripStore';

// AW19: a minták H3-cellája (res 10) – a Swift-pár: AtlagsebessegTests/TripTests.swift (`tripCell`, SwiftyH3), azonos névvel
describe('H3-cella (utak naplója)', () => {
  it('a minta H3-cellája res 10-en: Budapest és Győr ugyanaz, mint a SwiftyH3-ban', async () => {
    const cell = (await tripCellFn())!;
    expect(cell(47.4979, 19.0402)).toBe('8a1e03785377fff');
    expect(cell(47.6875, 17.6504)).toBe('8a1e020ce6a7fff');
    expect(cell(Number.NaN, 19)).toBeNull();
  });
});
