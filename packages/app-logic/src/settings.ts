export type SpeedUnit = 'kmh' | 'mph';

export interface Settings {
  /** A kijelző a határ + hatósági tűrést is mutatja (a számítás mindig a szigorú határhoz). */
  hatosagi_tures_megjelenitese: boolean;
  egyseg: SpeedUnit;
}

export const DEFAULT_SETTINGS: Settings = { hatosagi_tures_megjelenitese: false, egyseg: 'kmh' };
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
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
