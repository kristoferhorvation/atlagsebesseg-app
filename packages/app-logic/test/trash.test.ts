import { describe, expect, it } from 'vitest';
import { mergeHeatCells, TRASH_KEEP_MS, trashExpired, trashExpiresAt } from '../src/trips';

const day = 24 * 3600 * 1000;

// AOS17: a kuka logikája – a Swift-pár: AtlagsebessegTests/TripTests.swift (TrashTests), azonos nevekkel
describe('Összes törlése: 30 napos visszaállítás', () => {
  it('a törölt sor a 30. napig visszaállítható, utána lejár', () => {
    expect(TRASH_KEEP_MS).toBe(30 * day);
    expect(trashExpired(0, 30 * day)).toBe(false);
    expect(trashExpired(0, 30 * day + 1)).toBe(true);
    expect(trashExpiresAt([], 0)).toBeNull();
    expect(trashExpiresAt([0, 5 * day], 6 * day)).toBe(35 * day);
    expect(trashExpiresAt([0], 31 * day)).toBeNull();
  });

  it('a visszaállított cella a törlés óta keletkezettel súlyozottan összevonódik', () => {
    const a = { h3: 'x', count: 3, avgKmh: 50, lastT: 10 };
    expect(mergeHeatCells(a, null)).toEqual(a);
    expect(mergeHeatCells(a, { h3: 'x', count: 1, avgKmh: 90, lastT: 20 })).toEqual({ h3: 'x', count: 4, avgKmh: 60, lastT: 20 });
  });
});
