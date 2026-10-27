export type SpeedUnit = 'kmh' | 'mph';

/** A térkép kinézete: színes (Mapbox Standard `default`) vagy visszafogott (`monochrome`). */
export type MapLook = 'szines' | 'visszafogott';

export interface Settings {
  /** A kijelző a határ + hatósági tűrést is mutatja (a számítás mindig a szigorú határhoz). */
  hatosagi_tures_megjelenitese: boolean;
  egyseg: SpeedUnit;
  terkep: MapLook;
}

export const DEFAULT_SETTINGS: Settings = { hatosagi_tures_megjelenitese: false, egyseg: 'kmh', terkep: 'szines' };
export const SETTINGS_KEY = 'settings:v1';

/** Tárolt beállítások beolvasása; ismeretlen / sérült érték helyett az alapértelmezés. */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      hatosagi_tures_megjelenitese:
        typeof p.hatosagi_tures_megjelenitese === 'boolean' ? p.hatosagi_tures_megjelenitese : DEFAULT_SETTINGS.hatosagi_tures_megjelenitese,
      egyseg: p.egyseg === 'mph' || p.egyseg === 'kmh' ? p.egyseg : DEFAULT_SETTINGS.egyseg,
      terkep: p.terkep === 'szines' || p.terkep === 'visszafogott' ? p.terkep : DEFAULT_SETTINGS.terkep,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
