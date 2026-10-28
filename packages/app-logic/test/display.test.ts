import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, progressOf, sectionSourceLabel, speedFloorIn, speedIn, speedStatus } from '../src/display';
import { parseSettings, DEFAULT_SETTINGS } from '../src/settings';
import { reportFromFix } from '../src/reports';
import { MapStore } from '../src/mapState';

describe('speedStatus', () => {
  it('jó / lassíts / túl gyors – a „határon” sáv megszűnt', () => {
    expect(speedStatus(120, 125, 130)).toBe('jo');
    expect(speedStatus(129.9, 140, 130)).toBe('jo'); // az átlag ≤ határ: zöld
    expect(speedStatus(130.4, 129, 130)).toBe('lassits');
    expect(speedStatus(138, 120, 130)).toBe('lassits');
    expect(speedStatus(138, 131, 130)).toBe('tul_gyors');
    expect(speedStatus(48, 49, 50)).toBe('jo'); // nincs 3%-os sáv
    expect(speedStatus(null, 120, 130)).toBeNull();
  });
});

describe('egységek és formázás', () => {
  it('km/h és mph', () => {
    expect(speedIn(130, 'kmh')).toBe(130);
    expect(speedIn(130, 'mph')).toBe(81);
    expect(speedIn(null, 'kmh')).toBeNull();
    expect(speedFloorIn(136.5, 'kmh')).toBe(136); // a tűrés lefelé kerekül
    expect(speedFloorIn(136.9, 'kmh')).toBe(136);
    expect(speedFloorIn(null, 'kmh')).toBeNull();
  });
  it('távolság és idő', () => {
    expect(formatDistance(843, 'kmh')).toEqual({ value: '840', unit: 'm' });
    expect(formatDistance(12_345, 'kmh')).toEqual({ value: '12,3', unit: 'km' });
    expect(formatDistance(16_093, 'mph')).toEqual({ value: '10,0', unit: 'mi' });
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(progressOf(5, 10)).toBe(0.5);
    expect(progressOf(15, 10)).toBe(1);
  });
});

describe('beállítások', () => {
  it('hibás vagy hiányzó érték helyett alapértelmezés', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{rossz')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"egyseg":"furlong","hatosagi_tures_megjelenitese":true}')).toEqual({
      egyseg: 'kmh',
      hatosagi_tures_megjelenitese: true,
      terkep: 'szines',
    });
  });
  it('a térkép alapból színes; a visszafogott megmarad, ismeretlen érték színes', () => {
    expect(DEFAULT_SETTINGS.terkep).toBe('szines');
    expect(parseSettings('{"terkep":"visszafogott"}').terkep).toBe('visszafogott');
    expect(parseSettings('{"terkep":"monochrome"}').terkep).toBe('szines');
  });
});

describe('reportFromFix', () => {
  const fix = { lat: 46, lon: 11, timestamp: 0, speed: 30, accuracy: 5, heading: 359.6 };
  it('egyszerű bejelentés iránnyal', () => {
    expect(reportFromFix('rendorseg', fix)).toEqual({ type: 'rendorseg', lat: 46, lon: 11, heading_deg: 0 });
  });
  it('kapu: irány kell', () => {
    expect(reportFromFix('kapu_zaro', fix)).toMatchObject({ type: 'ideiglenes_kapu', gate_kind: 'zaro', heading_deg: 0 });
    expect(reportFromFix('kapu_kezdo', { ...fix, heading: null })).toBeNull();
  });
});

describe('MapStore', () => {
  it('csak változáskor értesít', () => {
    const store = new MapStore();
    let n = 0;
    store.subscribe(() => n++);
    store.set({ follow: true });
    store.set({ lightPreset: 'night' });
    expect(n).toBe(1);
  });
});

describe('sectionSourceLabel', () => {
  it('hivatalos forrás névvel és dátummal; különben a forrás típusa', () => {
    const provenance = { name: 'Polizia di Stato', url: 'https://www.poliziadistato.it/', date: '2026-08', locatedBy: 'km_szelveny' } as const;
    expect(sectionSourceLabel({ source: 'hivatalos', provenance })).toBe('Forrás: Polizia di Stato, 2026-08');
    expect(sectionSourceLabel({ source: 'osm' })).toBe('Forrás: OpenStreetMap');
    expect(sectionSourceLabel({ source: 'kozosseg' })).toBe('Forrás: közösségi (ideiglenes kapuk)');
  });
});
