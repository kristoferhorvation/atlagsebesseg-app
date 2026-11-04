import { describe, expect, it } from 'vitest';
import { color, statusColor } from '@atlagsebesseg/design-tokens';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings';
import { MAP_ERROR_KINDS, reportFromFix } from '../src/reports';
import hu from '../src/i18n/hu.json';

const fix = { lat: 47.5, lon: 19, timestamp: 0, speed: null, accuracy: 5, heading: 90 };

describe('AOS17', () => {
  it('a megosztás alapból BE', () => {
    expect(DEFAULT_SETTINGS.adatmegosztas).toBe(true);
    expect(parseSettings(null).adatmegosztas).toBe(true);
  });

  it('migráció: a régi tárolt KI egyszer BE-re vált, utána a felhasználó KI-je megmarad', () => {
    const migrated = parseSettings(JSON.stringify({ adatmegosztas: false, terkep: 'vilagos' }));
    expect(migrated.adatmegosztas).toBe(true);
    expect(migrated.terkep).toBe('vilagos');
    const off = JSON.stringify({ ...migrated, adatmegosztas: false });
    expect(parseSettings(off).adatmegosztas).toBe(false);
  });

  it('a Térképhiba alkategóriája a sorba kerül, más típusnál nincs; a sorrend a lapé', () => {
    expect(MAP_ERROR_KINDS).toEqual(['szakaszhatar', 'sebesseghatar', 'nem_letezik', 'hianyzo', 'kamera', 'egyeb']);
    expect(reportFromFix('szakasz_hiba', fix, 'kamera')).toMatchObject({ type: 'szakasz_hiba', subtype: 'kamera' });
    expect(reportFromFix('baleset', fix, 'kamera')).not.toHaveProperty('subtype');
    expect(reportFromFix('szakasz_hiba', fix)).not.toHaveProperty('subtype');
    // AW22: a Veszély altípusa
    expect(reportFromFix('akadaly', fix, 'katyu')).toMatchObject({ type: 'akadaly', subtype: 'katyu' });
    expect(reportFromFix('akadaly', fix, 'kamera')).not.toHaveProperty('subtype');
    expect(reportFromFix('szakasz_hiba', fix, 'katyu')).not.toHaveProperty('subtype');
  });

  it('a bejelentés alsó szövege szó szerint a tulajdonosi szöveg', () => {
    expect(hu['report.note.default']).toBe('A jelenlegi helyed és haladási irányod kerül a bejelentésbe. Ideiglenes szakasz: a mérés végén a „Vége” gomb jelenti be a záró kaput.');
    expect(hu['report.type.szakasz_hiba']).toBe('Térképhiba');
  });

  it('a jelölőszín a zöld; a kézi mód az eddigi színén marad', () => {
    expect(color.accent).toBe(color.ok);
    expect(statusColor.kezi).toBe('#7A86FF');
    expect(color.brand).toBe('#7A86FF');
  });
});
