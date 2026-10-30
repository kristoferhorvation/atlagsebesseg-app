import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, progressOf, sectionSourceLabel, speedFloorIn, speedIn, speedStatus } from '../src/display';
import { parseSettings, DEFAULT_SETTINGS, MAP_LOOKS, type MapLook } from '../src/settings';
import { lightPresetAt, mapLightPreset, mapTheme, strongGlassFor, type LightPreset } from '../src/lightPreset';
import { REPORT_CHOICES, reportChoiceLabel, reportFromFix } from '../src/reports';
import { setLanguage } from '../src/i18n';
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
      tervezett_meresek: true,
      hangos_utasitasok: true,
      megszolitas: '',
    });
  });
  it('a térkép alapból színes; a visszafogott megmarad, ismeretlen érték színes; a sorrend Világos, Színes, Visszafogott', () => {
    expect(DEFAULT_SETTINGS.terkep).toBe('szines');
    expect(parseSettings('{"terkep":"visszafogott"}').terkep).toBe('visszafogott');
    expect(parseSettings('{"terkep":"monochrome"}').terkep).toBe('szines');
    expect(MAP_LOOKS).toEqual(['vilagos', 'szines', 'visszafogott']);
  });
  it('AW16: a téma a kinézetből; a „Világos” tárolva megmarad', () => {
    expect(parseSettings('{"terkep":"vilagos"}').terkep).toBe('vilagos');
    expect([mapTheme('szines'), mapTheme('visszafogott'), mapTheme('vilagos')]).toEqual(['default', 'monochrome', 'default']);
  });
  it('AW16: lightPreset-szabály napszakonként és stílusonként (a sötét mód sehol nem számít)', () => {
    // napszak szerinti alap → a ténylegesen alkalmazott fény
    const expected: Record<MapLook, Record<LightPreset, LightPreset>> = {
      vilagos: { day: 'day', dawn: 'dawn', dusk: 'dusk', night: 'night' },
      szines: { day: 'dusk', dawn: 'dawn', dusk: 'dusk', night: 'night' },
      visszafogott: { day: 'day', dawn: 'dawn', dusk: 'dusk', night: 'night' },
    };
    for (const look of MAP_LOOKS) for (const p of ['dawn', 'day', 'dusk', 'night'] as LightPreset[]) expect(mapLightPreset(look, p), `${look}/${p}`).toBe(expected[look][p]);
  });
  it('AW16: a végigfutó lánc (időpont + hely → stílus): délben, napnyugtakor és éjjel', () => {
    const budapest = { lat: 47.5, lon: 19.04 };
    const noon = Date.UTC(2026, 5, 21, 10, 0); // nyári dél (UTC)
    const night = Date.UTC(2026, 5, 21, 23, 30);
    const at = (look: MapLook, ms: number) => mapLightPreset(look, lightPresetAt(ms, budapest));
    expect([at('vilagos', noon), at('szines', noon), at('visszafogott', noon)]).toEqual(['day', 'dusk', 'day']);
    expect([at('vilagos', night), at('szines', night), at('visszafogott', night)]).toEqual(['night', 'night', 'night']);
    // helyzet nélkül nappal
    expect(mapLightPreset('szines', lightPresetAt(noon, null))).toBe('dusk');
    expect(mapLightPreset('vilagos', lightPresetAt(noon, null))).toBe('day');
  });
  it('AW16: erősebb üveg csak a nappali fényű „Világos” térképen', () => {
    expect(strongGlassFor('vilagos', 'day')).toBe(true);
    expect(strongGlassFor('vilagos', 'night')).toBe(false);
    expect(strongGlassFor('vilagos', 'dusk')).toBe(false);
    expect(strongGlassFor('szines', 'day')).toBe(false);
    expect(strongGlassFor('visszafogott', 'day')).toBe(false);
  });
});

describe('AW16: bejelentés-típusok', () => {
  it('a menü aljára kerül az „Átlagmérés eleje / vége”, az ideiglenes szakasz folyamat megszűnt', () => {
    expect(REPORT_CHOICES.map((c) => c.id)).toEqual(['rendorseg', 'traffipax', 'baleset', 'akadaly', 'utlezaras', 'szakasz_hiba', 'dugo', 'beallt', 'kapu_kezdo', 'kapu_zaro']);
    expect(reportChoiceLabel('kapu_kezdo')).toBe('Átlagmérés eleje');
    expect(reportChoiceLabel('kapu_zaro')).toBe('Átlagmérés vége');
  });
  it('mindkettő a meglévő kapu-jelentés: ideiglenes_kapu, kezdő / záró, a jelenlegi hely és irány', () => {
    const fix = { lat: 46, lon: 11, timestamp: 0, speed: 30, accuracy: 5, heading: 90 };
    expect(reportFromFix('kapu_kezdo', fix)).toEqual({ type: 'ideiglenes_kapu', gate_kind: 'kezdo', lat: 46, lon: 11, heading_deg: 90, road: null, speed_limit_kmh: null });
    expect(reportFromFix('kapu_zaro', fix)).toMatchObject({ type: 'ideiglenes_kapu', gate_kind: 'zaro', heading_deg: 90 });
    // irány nélkül nincs kapu
    expect(reportFromFix('kapu_zaro', { ...fix, heading: null })).toBeNull();
  });
  it('mind a 6 nyelven van felirata', () => {
    for (const l of ['hu', 'en', 'de', 'sk', 'cs', 'pl'] as const) {
      setLanguage(l);
      expect(reportChoiceLabel('kapu_kezdo'), l).not.toBe('report.type.kapu_kezdo');
      expect(reportChoiceLabel('kapu_zaro'), l).not.toBe(reportChoiceLabel('kapu_kezdo'));
    }
    setLanguage('hu');
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
