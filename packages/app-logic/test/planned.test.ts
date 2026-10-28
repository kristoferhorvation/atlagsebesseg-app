import { describe, expect, it, vi } from 'vitest';
import { LocalProjection, type GpsFix } from '@atlagsebesseg/core';
import { BUNDLED_CAMERAS } from '../src/bundledCameras';
import { cameraSourceText, cameraVisibility, cameraWarning, visibleCameras, type FixedCamera } from '../src/cameras';
import {
  onPlannedLine,
  PlannedCheckWatch,
  plannedBandText,
  plannedCheckActive,
  plannedDateRange,
  rowToPlannedCheck,
  type PlannedCheck,
} from '../src/plannedChecks';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings';
import { TileCache, type KeyValueStore } from '../src/sectionCache';

const proj = new LocalProjection({ lat: 47.2, lon: 18.4 });
const at = (x: number, y: number) => proj.fromXY({ x, y });
const fix = (x: number, y: number, t = 0): GpsFix => ({ ...at(x, y), timestamp: t, speed: 20, accuracy: 5, heading: 90 });

// 2026-10-27 (kedd) 00:00 – 2026-11-01 (vasárnap) 23:59:59, budapesti idő
const FROM = Date.parse('2026-10-26T23:00:00Z');
const TO = Date.parse('2026-11-01T22:59:59Z');

const check = (extra: Partial<PlannedCheck> = {}): PlannedCheck => ({
  id: 'pc-1',
  country: 'HU',
  county: 'Fejér',
  settlement: 'Székesfehérvár',
  roadRef: '7',
  description: 'Székesfehérvár 7-es főút',
  lines: [[at(0, 0), at(1000, 0), at(2000, 0)]],
  speedLimitKmh: 90,
  limitSource: 'osm',
  validFrom: FROM,
  validTo: TO,
  timeWindow: null,
  sourceUrl: 'https://www.police.hu/',
  ...extra,
});

const NOW = Date.parse('2026-10-28T10:00:00Z');

describe('tervezett mérés – a vonalon haladás (40 m tűrés)', () => {
  it('a vonalon / 40 m-en belül igen, azon túl és a végeken túl nem', () => {
    const c = check();
    expect(onPlannedLine(at(500, 0), c)).toBe(true);
    expect(onPlannedLine(at(500, 35), c)).toBe(true);
    expect(onPlannedLine(at(500, 60), c)).toBe(false);
    expect(onPlannedLine(at(2300, 0), c)).toBe(false);
    expect(onPlannedLine(at(-300, 0), c)).toBe(false);
  });

  it('a sáv a vonalra érve megjelenik, letéréskor (2 fix) eltűnik; egy kiugró fix nem tünteti el', () => {
    const w = new PlannedCheckWatch();
    const c = [check()];
    expect(w.update(fix(-500, 0), c, NOW)).toBeNull();
    expect(w.update(fix(100, 0), c, NOW)?.id).toBe('pc-1');
    expect(w.update(fix(600, 80), c, NOW)?.id).toBe('pc-1'); // egy kiugró pont
    expect(w.update(fix(900, 0), c, NOW)?.id).toBe('pc-1');
    expect(w.update(fix(1200, 200), c, NOW)?.id).toBe('pc-1');
    expect(w.update(fix(1300, 400), c, NOW)).toBeNull(); // letért
  });

  it('lejárt vagy még nem érvényes mérésnél nincs sáv', () => {
    const w = new PlannedCheckWatch();
    expect(w.update(fix(100, 0), [check({ validTo: NOW - 1 })], NOW)).toBeNull();
    expect(w.update(fix(100, 0), [check({ validFrom: NOW + 3600_000 })], NOW)).toBeNull();
    expect(plannedCheckActive(check(), NOW)).toBe(true);
  });

  it('több vonal (osztott pálya): bármelyiken', () => {
    const c = check({ lines: [[at(0, 15), at(2000, 15)], [at(2000, -15), at(0, -15)]] });
    expect(onPlannedLine(at(800, -15), c)).toBe(true);
  });

  it('Svájcban (hide) a tervezett mérés sem látszik', () => {
    expect(plannedCheckActive(check({ country: 'CH' }), NOW)).toBe(false);
  });
});

describe('a sáv szövege', () => {
  it('„Tervezett rendőrségi mérés · okt 27–nov 1 · max 90”', () => {
    expect(plannedBandText(check())).toBe('Tervezett rendőrségi mérés · okt 27–nov 1 · max 90');
  });

  it('KRESZ-alapértéknél „max ~90”; időszakkal', () => {
    expect(plannedBandText(check({ limitSource: 'kresz_default', timeWindow: 'ápr 15. 6:00 – ápr 16. 6:00' }))).toBe(
      'Tervezett rendőrségi mérés · okt 27–nov 1 · max ~90 · ápr 15. 6:00 – ápr 16. 6:00',
    );
  });

  it('egy hónapon belül: „ápr 15–19”', () => {
    expect(plannedDateRange({ validFrom: Date.parse('2026-04-15T04:00:00Z'), validTo: Date.parse('2026-04-19T21:59:59Z') })).toBe('ápr 15–19');
  });

  it('sorból (LineString és MultiLineString)', () => {
    const base = {
      id: 'x',
      country: 'HU',
      county: 'Pest',
      settlement: 'Budaörs',
      road_ref: 'M1',
      description: 'Budaörs, M1 autópálya',
      speed_limit_kmh: 130,
      limit_source: 'osm' as const,
      valid_from: '2026-10-26T23:00:00Z',
      valid_to: '2026-11-01T22:59:59Z',
      time_window: null,
      source_url: 'https://www.police.hu/',
    };
    const one = rowToPlannedCheck({ ...base, geometry: { type: 'LineString', coordinates: [[18.9, 47.4], [18.91, 47.41]] } });
    expect(one.lines).toEqual([[{ lat: 47.4, lon: 18.9 }, { lat: 47.41, lon: 18.91 }]]);
    const two = rowToPlannedCheck({ ...base, geometry: { type: 'MultiLineString', coordinates: [[[18.9, 47.4], [18.91, 47.41]], [[18.91, 47.41], [18.9, 47.4]]] } });
    expect(two.lines).toHaveLength(2);
  });
});

describe('jogi láthatóság (camera_visibility.json)', () => {
  it('induló értékek', () => {
    for (const c of ['HU', 'AT', 'IT', 'PL', 'ES', 'NL', 'GB', 'DE']) expect(cameraVisibility(c)).toBe('show');
    expect(cameraVisibility('FR')).toBe('zone');
    expect(cameraVisibility('CH')).toBe('hide');
    expect(cameraVisibility('SK')).toBe('show');
    expect(cameraWarning('DE')).toBe('Németországban a vezető nem használhatja ezt a funkciót');
    expect(cameraWarning('HU')).toBeNull();
  });

  it('show → pont, zone → ±1 km zóna pont nélkül (rácsra kerekítve), hide → semmi', () => {
    const cam = (id: string, country: string, lat = 47.1, lon = 18.1): FixedCamera => ({
      id,
      country,
      type: 'speed',
      lat,
      lon,
      headingDeg: null,
      road: '',
      speedLimitKmh: null,
      source: 'OpenStreetMap',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      sourceDate: '2026-10-28',
      verified: false,
    });
    const v = visibleCameras([cam('a', 'HU'), cam('b', 'FR', 48.85123, 2.35123), cam('c', 'CH'), cam('d', 'FR', 48.85124, 2.35124)]);
    expect(v.points.map((c) => c.id)).toEqual(['a']);
    expect(v.zones).toHaveLength(1); // két közeli francia kamera egy zóna
    expect(v.zones[0]!.radiusM).toBe(1000);
    expect(v.zones[0]!.center.lat).not.toBe(48.85123);
  });

  it('a kártya forrás-sora', () => {
    expect(cameraSourceText({ verified: true, type: 'complex', sourceDate: '2015-11', country: 'HU' })).toContain('VÉDA');
    expect(cameraSourceText({ verified: false, type: 'speed', sourceDate: '2026-10-28', country: 'HU' })).toContain('nem ellenőrzött');
  });
});

describe('beépített kamerák és beállítás', () => {
  it('a csomagolt HU-lista: VÉDA ellenőrzött + OSM', () => {
    expect(BUNDLED_CAMERAS.length).toBeGreaterThan(300);
    expect(BUNDLED_CAMERAS.some((c) => c.type === 'complex' && c.verified)).toBe(true);
    expect(BUNDLED_CAMERAS.every((c) => c.country === 'HU')).toBe(true);
  });

  it('„Tervezett mérések mutatása” alapból be; régi tárolt beállításnál is', () => {
    expect(DEFAULT_SETTINGS.tervezett_meresek).toBe(true);
    expect(parseSettings('{"egyseg":"kmh"}').tervezett_meresek).toBe(true);
    expect(parseSettings('{"tervezett_meresek":false}').tervezett_meresek).toBe(false);
  });
});

describe('TileCache (kamerák, tervezett mérések)', () => {
  it('saját előtaggal tárol, nem keveredik a szakaszokkal', async () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
    const fetch = vi.fn(async () => [{ id: 'cam-1' }]);
    const cache = new TileCache(store, fetch, { prefix: 'cameras', radius: 0 });
    const r = await cache.loadItems(47.2, 18.4);
    expect(r.items).toEqual([{ id: 'cam-1' }]);
    expect([...data.keys()]).toEqual(['cameras:tile:94:36']);
    expect((await cache.loadItems(47.2, 18.4)).fromCache).toBe(1);
  });
});
