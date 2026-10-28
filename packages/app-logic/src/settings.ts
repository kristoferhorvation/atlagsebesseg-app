export type SpeedUnit = 'kmh' | 'mph';

/** A térkép kinézete: színes (Mapbox Standard `default`) vagy visszafogott (`monochrome`). */
export type MapLook = 'szines' | 'visszafogott';

export interface Settings {
  /** A kijelző a határ + hatósági tűrést is mutatja (a számítás mindig a szigorú határhoz). */
  hatosagi_tures_megjelenitese: boolean;
  egyseg: SpeedUnit;
  terkep: MapLook;
  /** A rendőrség által előre közzétett mérési helyszínek (vonal + sáv); a fix kamerákat nem érinti. */
  tervezett_meresek: boolean;
  /** Navigáció: a fordulók, a közeledő szakasz és a „túl gyors” állapot bemondása (alapból be). */
  hangos_utasitasok: boolean;
}

export const DEFAULT_SETTINGS: Settings = { hatosagi_tures_megjelenitese: false, egyseg: 'kmh', terkep: 'szines', tervezett_meresek: true, hangos_utasitasok: true };
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
      tervezett_meresek: typeof p.tervezett_meresek === 'boolean' ? p.tervezett_meresek : DEFAULT_SETTINGS.tervezett_meresek,
      hangos_utasitasok: typeof p.hangos_utasitasok === 'boolean' ? p.hangos_utasitasok : DEFAULT_SETTINGS.hangos_utasitasok,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
