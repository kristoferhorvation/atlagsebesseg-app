import { describe, expect, it, vi } from 'vitest';
import { LocalProjection, type GpsFix } from '@atlagsebesseg/core';
import { BUNDLED_CAMERAS } from '../src/bundledCameras';
import { cameraCardDetail, cameraCardMeta, cameraDirection, cameraSourceText, cameraVisibility, cameraWarning, visibleCameras, type FixedCamera } from '../src/cameras';
import {
  inPlannedZone,
  onPlannedLine,
  PLANNED_MATCH_M,
  PlannedCheckWatch,
  plannedBandText,
  plannedIsZone,
  plannedZoneText,
  plannedCheckActive,
  plannedDateRange,
  rowToPlannedCheck,
  type PlannedCheck,
} from '../src/plannedChecks';
import visibility from '../../data/camera_visibility.json';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings';

const VISIBILITY_WARNING_KEYS = Object.values(visibility.countries).flatMap((c) => ('warning' in c ? [c.warning] : []));
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
  zones: [],
  speedLimitKmh: 90,
  limitSource: 'osm',
  validFrom: FROM,
  validTo: TO,
  timeWindow: null,
  sourceUrl: 'https://www.police.hu/',
  ...extra,
});

const NOW = Date.parse('2026-10-28T10:00:00Z');

describe('tervezett mérés – a vonalon haladás (100 m tűrés)', () => {
  it('a vonalon / 100 m-en belül igen, azon túl és a végeken túl nem', () => {
    const c = check();
    expect(PLANNED_MATCH_M).toBe(100);
    expect(onPlannedLine(at(500, 0), c)).toBe(true);
    expect(onPlannedLine(at(500, 60), c)).toBe(true);
    expect(onPlannedLine(at(500, 95), c)).toBe(true);
    expect(onPlannedLine(at(500, 130), c)).toBe(false);
    expect(onPlannedLine(at(2300, 0), c)).toBe(false);
    expect(onPlannedLine(at(-300, 0), c)).toBe(false);
  });

  it('a sáv a vonalra érve megjelenik, letéréskor (2 fix) eltűnik; egy kiugró fix nem tünteti el', () => {
    const w = new PlannedCheckWatch();
    const c = [check()];
    expect(w.update(fix(-500, 0), c, NOW)).toBeNull();
    expect(w.update(fix(100, 0), c, NOW)?.id).toBe('pc-1');
    expect(w.update(fix(600, 180), c, NOW)?.id).toBe('pc-1'); // egy kiugró pont
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

// Székesfehérvár „határa”: 4 × 4 km-es négyzet, közepén 1 × 1 km-es lyuk (pl. enklávé)
const square = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
const zone = (extra: Partial<PlannedCheck> = {}): PlannedCheck =>
  check({ roadRef: null, lines: [], zones: [[square(0, -2000, 4000, 2000), square(1500, -500, 2500, 500)]], description: 'Székesfehérvár', ...extra });

describe('zóna-típusú tervezett mérés (csak települést adó közlemény)', () => {
  it('a határon belül igen, kívül és a lyukban nem', () => {
    const c = zone();
    expect(plannedIsZone(c)).toBe(true);
    expect(inPlannedZone(at(500, 0), c)).toBe(true);
    expect(inPlannedZone(at(3500, 1800), c)).toBe(true);
    expect(inPlannedZone(at(5000, 0), c)).toBe(false);
    expect(inPlannedZone(at(2000, 0), c)).toBe(false); // lyuk
    expect(onPlannedLine(at(500, 0), c)).toBe(false); // vonalnak nem számít
  });

  it('a sáv a településre érve megjelenik, bent maradva nem tűnik el (egy kiugró fix sem), kilépve igen', () => {
    const w = new PlannedCheckWatch();
    const c = [zone()];
    expect(w.update(fix(-300, 0), c, NOW)).toBeNull();
    expect(w.update(fix(100, 0), c, NOW)?.id).toBe('pc-1');
    expect(w.update(fix(3000, 1500), c, NOW)?.id).toBe('pc-1'); // a településen belül bárhol
    expect(w.update(fix(6000, 0), c, NOW)?.id).toBe('pc-1'); // egy kiugró pont
    expect(w.update(fix(3500, 100), c, NOW)?.id).toBe('pc-1');
    expect(w.update(fix(6000, 0), c, NOW)?.id).toBe('pc-1');
    expect(w.update(fix(6100, 0), c, NOW)).toBeNull(); // kilépett
  });

  it('lejárt zónánál nincs sáv (csak aktuális dátumra látszik)', () => {
    const w = new PlannedCheckWatch();
    expect(w.update(fix(100, 0), [zone({ validTo: NOW - 1 })], NOW)).toBeNull();
    expect(w.update(fix(100, 0), [zone({ validFrom: NOW + 3600_000 })], NOW)).toBeNull();
  });

  it('vonal és zóna egyszerre: a vonal (pontosabb hely) az erősebb, a vonalról lelépve a zóna marad', () => {
    const w = new PlannedCheckWatch();
    const z = zone({ id: 'zone-1' });
    const l = check({ id: 'line-1', lines: [[at(0, 0), at(1000, 0)]] });
    expect(w.update(fix(100, 0), [z, l], NOW)?.id).toBe('line-1');
    expect(w.update(fix(100, 400), [z, l], NOW)?.id).toBe('zone-1'); // a vonalról lelépett, de még a településen
  });

  it('a zóna-sor szövege: település, dátum, forrás (a szótárból)', () => {
    expect(plannedZoneText(zone())).toBe('Rendőrségi mérés Székesfehérvár területén · okt 27–nov 1 · forrás: police.hu');
    expect(plannedBandText(zone())).toBe(plannedZoneText(zone()));
  });

  it('sorból (Polygon és MultiPolygon, lyukkal)', () => {
    const base = {
      id: 'z',
      country: 'HU',
      county: 'Fejér',
      settlement: 'Székesfehérvár',
      road_ref: null,
      description: 'Székesfehérvár',
      speed_limit_kmh: 50,
      limit_source: 'kresz_default' as const,
      valid_from: '2026-10-26T23:00:00Z',
      valid_to: '2026-11-01T22:59:59Z',
      time_window: null,
      source_url: 'https://www.police.hu/',
    };
    const ring: [number, number][] = [[18.4, 47.1], [18.5, 47.1], [18.5, 47.2], [18.4, 47.2], [18.4, 47.1]];
    const hole: [number, number][] = [[18.44, 47.14], [18.46, 47.14], [18.46, 47.16], [18.44, 47.16], [18.44, 47.14]];
    const one = rowToPlannedCheck({ ...base, geometry: { type: 'Polygon', coordinates: [ring, hole] } });
    expect(one.lines).toEqual([]);
    expect(one.zones).toHaveLength(1);
    expect(one.zones[0]).toHaveLength(2);
    expect(one.zones[0]![0]![0]).toEqual({ lat: 47.1, lon: 18.4 });
    expect(inPlannedZone({ lat: 47.12, lon: 18.41 }, one)).toBe(true);
    expect(inPlannedZone({ lat: 47.15, lon: 18.45 }, one)).toBe(false);
    const two = rowToPlannedCheck({ ...base, geometry: { type: 'MultiPolygon', coordinates: [[ring], [hole]] } });
    expect(two.zones).toHaveLength(2);
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
    expect(VISIBILITY_WARNING_KEYS).toEqual(['warn.camera.DE']);
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

  it('a kamera-kártya: irány a haladáshoz képest, távolság, út és limit (AOS15)', () => {
    expect(cameraDirection({ headingDeg: null }, 90)).toBe('any');
    expect(cameraDirection({ headingDeg: 80 }, null)).toBe('one');
    expect(cameraDirection({ headingDeg: 80 }, 90)).toBe('ours');
    expect(cameraDirection({ headingDeg: 0 }, 90)).toBe('ours'); // 90° még a miénk
    expect(cameraDirection({ headingDeg: 350 }, 90)).toBe('other');
    expect(cameraDirection({ headingDeg: 270 }, 90)).toBe('other');
    const cam = { headingDeg: 270, lat: 47.5, lon: 19.0 };
    // ~1,2 km-re északra
    const fix = { lat: 47.5 - 1200 / 111_195, lon: 19.0, heading: 90 };
    expect(cameraCardMeta(cam, fix, 'kmh')).toBe('Az ellenirányt méri · 1,2 km távolságra');
    expect(cameraCardMeta({ ...cam, headingDeg: null }, null, 'kmh')).toBe('Mindkét irányban mér');
    expect(cameraCardMeta(cam, { ...fix, heading: null }, 'mph')).toBe('Egy irányban mér · 0,7 mi távolságra');
    expect(cameraCardDetail({ road: 'M1', speedLimitKmh: 130 }, 'kmh')).toBe('M1 · 130 km/h');
    expect(cameraCardDetail({ road: 'M1', speedLimitKmh: 130 }, 'mph')).toBe('M1 · 81 mph');
    expect(cameraCardDetail({ road: '', speedLimitKmh: null }, 'kmh')).toBe('');
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
