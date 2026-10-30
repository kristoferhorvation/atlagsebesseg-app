import { describe, expect, it, vi } from 'vitest';
import type { ManualResult, Section } from '@atlagsebesseg/core';
import { chooseLightPreset } from '../src/lightPreset';
import { mergeById, SectionCache, tileBBox, tileKey, tilesAround, type KeyValueStore } from '../src/sectionCache';

const sec = (id: string, lat = 46, lon = 11): Section => ({
  id,
  country: 'IT',
  road: 'A1',
  direction: '',
  start: { lat, lon },
  end: { lat: lat + 0.1, lon },
  lengthM: 11000,
  speedLimitKmh: 130,
  source: 'osm',
  verified: false,
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

describe('csempék', () => {
  it('kulcs, befoglaló téglalap, szomszédok', () => {
    expect(tileKey(46.2, 11.7)).toBe('92:23');
    expect(tileBBox('92:23')).toEqual({ south: 46, west: 11.5, north: 46.5, east: 12 });
    expect(tilesAround(46.2, 11.7)).toHaveLength(9);
    expect(tilesAround(-0.1, -0.1, 0)).toEqual(['-1:-1']);
  });
});

describe('SectionCache', () => {
  it('első betöltés hálózatról, utána cache-ből; azonosító szerint egyesít', async () => {
    const store = memoryStore();
    const fetch = vi.fn(async () => [sec('a'), sec('b')]);
    let now = 1_000_000;
    const cache = new SectionCache(store, fetch, { now: () => now, radius: 1 });
    const first = await cache.load(46.2, 11.7);
    expect(first).toMatchObject({ fromNetwork: 9, fromCache: 0, missing: 0, stale: false });
    expect(first.sections.map((s) => s.id)).toEqual(['a', 'b']);
    now += 3600_000;
    const second = await cache.load(46.2, 11.7);
    expect(second.fromCache).toBe(9);
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it('lejárt cache: újra lekéri; ha nincs hálózat, a lejárt cache-t adja (offline)', async () => {
    const store = memoryStore();
    let online = true;
    let now = 0;
    const cache = new SectionCache(store, async () => (online ? [sec('a')] : Promise.reject(new Error('offline'))), {
      now: () => now,
      radius: 0,
      ttlMs: 1000,
    });
    await cache.load(46.2, 11.7);
    now = 5000;
    online = false;
    const r = await cache.load(46.2, 11.7);
    expect(r).toMatchObject({ fromCache: 1, fromNetwork: 0, stale: true });
    expect(r.sections.map((s) => s.id)).toEqual(['a']);
  });

  it('se hálózat, se cache: üres, a hiányzó csempék száma', async () => {
    const cache = new SectionCache(memoryStore(), async () => Promise.reject(new Error('offline')), { radius: 0 });
    expect(await cache.load(46.2, 11.7)).toMatchObject({ sections: [], missing: 1 });
  });

  it('sérült cache-bejegyzés nem dönti el', async () => {
    const store = memoryStore();
    store.data.set(`sections:tile:${tileKey(46.2, 11.7)}`, '{nem json');
    const cache = new SectionCache(store, async () => [sec('x')], { radius: 0 });
    expect((await cache.load(46.2, 11.7)).sections.map((s) => s.id)).toEqual(['x']);
  });

  it('mergeById: a későbbi lista nyer', () => {
    const merged = mergeById([sec('a'), { ...sec('b'), speedLimitKmh: 110 }], [{ ...sec('b'), speedLimitKmh: 90 }]);
    expect(merged.find((s) => s.id === 'b')!.speedLimitKmh).toBe(90);
    expect(merged).toHaveLength(2);
  });
});

describe('chooseLightPreset', () => {
  it('a napszak dönt (a készülék sötét módja nem számít)', () => {
    expect(chooseLightPreset('nappal')).toBe('day');
    expect(chooseLightPreset('hajnal')).toBe('dawn');
    expect(chooseLightPreset('alkony')).toBe('dusk');
    expect(chooseLightPreset('ejszaka')).toBe('night');
  });
  it('helyzet nélkül nappal', () => {
    expect(chooseLightPreset(null)).toBe('day');
  });
});
