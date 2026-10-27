import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, progressOf, speedIn, speedStatus } from '../src/display';
import { parseSettings, DEFAULT_SETTINGS } from '../src/settings';
import { reportFromFix } from '../src/reports';
import { MapStore } from '../src/mapState';

describe('speedStatus', () => {
  it('jó / határon / túl', () => {
    expect(speedStatus(120, 130)).toBe('jo');
    expect(speedStatus(126.5, 130)).toBe('hataron'); // 3% = 3,9
    expect(speedStatus(130, 130)).toBe('hataron');
    expect(speedStatus(130.4, 130)).toBe('tul');
    expect(speedStatus(48, 50)).toBe('hataron'); // min. 3 km/h
    expect(speedStatus(null, 130)).toBeNull();
  });
});

describe('egységek és formázás', () => {
  it('km/h és mph', () => {
    expect(speedIn(130, 'kmh')).toBe(130);
    expect(speedIn(130, 'mph')).toBe(81);
    expect(speedIn(null, 'kmh')).toBeNull();
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
