import { HEAT_MODES, HEAT_VIEWS, parseZoneRadii, type HeatMode, type HeatView } from './heat';

export type SpeedUnit = 'kmh' | 'mph';

/**
 * A térkép kinézete (AW16): világos (`default` téma, napközben nappali fény), színes (`default` téma, napközben alkonyi
 * fény – az alap) vagy visszafogott (`monochrome`); napnyugtakor és éjjel a fény mindháromnál azonos – `mapLightPreset`.
 */
export type MapLook = 'szines' | 'visszafogott' | 'vilagos';
export const MAP_LOOKS: readonly MapLook[] = ['vilagos', 'szines', 'visszafogott'];

export interface Settings {
  /** A kijelző a határ + hatósági tűrést is mutatja (a számítás mindig a szigorú határhoz). */
  hatosagi_tures_megjelenitese: boolean;
  egyseg: SpeedUnit;
  terkep: MapLook;
  /** A rendőrség által előre közzétett mérési helyszínek (vonal + sáv); a fix kamerákat nem érinti. */
  tervezett_meresek: boolean;
  /** Navigáció: a fordulók, a közeledő szakasz és a „túl gyors” állapot bemondása (alapból be). */
  hangos_utasitasok: boolean;
  /** AOS14: a köszöntés neve („Szia Kristof!”); üresen név nélkül köszön („Szia!”). */
  megszolitas: string;
  /** AW20: hőtérkép – ki / saját (helyi) / közösségi. */
  hoterkep: HeatMode;
  /** AW20: a hőtérkép módja – gyakoriság / átlagsebesség. */
  hoterkep_nezet: HeatView;
  /** AW20: névtelen vezetési adatok megosztása a közösségi hőtérképhez (alapból ki). */
  adatmegosztas: boolean;
  /** AOS17: az alapból-BE egyszeri migrációja lefutott (a mentéssel együtt tárolódik). */
  adatmegosztas_v2: boolean;
  /** AW20-javítás: az adatvédelmi zóna sugara (m) mentett helyenként (`home`, `work`, további hely azonosítója); hiányzó = 500 m. Csak helyben. */
  zona_m: Record<string, number>;
  /** AW22: a napló és a saját hőtérkép felhős mentése (bejelentkezve; alapból ki). */
  felho_mentes: boolean;
  /** AW24: a `felho_mentes` alapból BE; a jelölő nélküli (régi, alapból KI) tárolt érték egyszer átáll. */
  felho_mentes_v2: boolean;
}

/** A megszólítás legfeljebb ennyi karakter (a köszöntő sor egy sorban maradjon). */
export const MEGSZOLITAS_MAX = 24;

/** A tárolt / beírt név: szélein vágva, a belső szóközök egyre, legfeljebb `MEGSZOLITAS_MAX` karakter. */
export const normalizeName = (raw: string): string => [...raw.replace(/\s+/g, ' ').trim()].slice(0, MEGSZOLITAS_MAX).join('').trim();

export const DEFAULT_SETTINGS: Settings = { hatosagi_tures_megjelenitese: false, egyseg: 'kmh', terkep: 'szines', tervezett_meresek: true, hangos_utasitasok: true, megszolitas: '', hoterkep: 'sajat', hoterkep_nezet: 'gyakorisag', adatmegosztas: true, adatmegosztas_v2: true, zona_m: {}, felho_mentes: true, felho_mentes_v2: true };
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
      terkep: MAP_LOOKS.includes(p.terkep as MapLook) ? (p.terkep as MapLook) : DEFAULT_SETTINGS.terkep,
      tervezett_meresek: typeof p.tervezett_meresek === 'boolean' ? p.tervezett_meresek : DEFAULT_SETTINGS.tervezett_meresek,
      hangos_utasitasok: typeof p.hangos_utasitasok === 'boolean' ? p.hangos_utasitasok : DEFAULT_SETTINGS.hangos_utasitasok,
      megszolitas: typeof p.megszolitas === 'string' ? normalizeName(p.megszolitas) : DEFAULT_SETTINGS.megszolitas,
      hoterkep: HEAT_MODES.includes(p.hoterkep as HeatMode) ? (p.hoterkep as HeatMode) : DEFAULT_SETTINGS.hoterkep,
      hoterkep_nezet: HEAT_VIEWS.includes(p.hoterkep_nezet as HeatView) ? (p.hoterkep_nezet as HeatView) : DEFAULT_SETTINGS.hoterkep_nezet,
      // AOS17: egyszeri migráció – az `adatmegosztas_v2` jelölő nélküli (régi) tárolt érték helyett BE; utána a felhasználó választása marad
      adatmegosztas: p.adatmegosztas_v2 === true && typeof p.adatmegosztas === 'boolean' ? p.adatmegosztas : DEFAULT_SETTINGS.adatmegosztas,
      adatmegosztas_v2: true,
      zona_m: parseZoneRadii(p.zona_m),
      felho_mentes: p.felho_mentes_v2 === true && typeof p.felho_mentes === 'boolean' ? p.felho_mentes : DEFAULT_SETTINGS.felho_mentes,
      felho_mentes_v2: true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
