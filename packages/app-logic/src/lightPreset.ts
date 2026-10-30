import { sunPhase, type SunPhase } from '@atlagsebesseg/core';
import type { MapLook } from './settings';

/** A Mapbox Standard stílus fény-előbeállítása. */
export type LightPreset = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * Térkép-előbeállítás a helyi napszakból (AW16: a készülék sötét módja sehol nem számít): nappal → day, hajnal → dawn,
 * alkony → dusk, éjszaka → night. Helyzet nélkül (még nincs GPS) nappal.
 */
export function chooseLightPreset(phase: SunPhase | null): LightPreset {
  if (!phase) return 'day';
  return ({ nappal: 'day', hajnal: 'dawn', alkony: 'dusk', ejszaka: 'night' } as const)[phase];
}

/** Napszak szerinti előbeállítás egy időpontra és helyre. */
export function lightPresetAt(nowMs: number, pos: { lat: number; lon: number } | null): LightPreset {
  return chooseLightPreset(pos ? sunPhase(nowMs, pos.lat, pos.lon) : null);
}

/** A Mapbox Standard `theme` a térkép kinézetéből (a „Világos” és a „Színes” is a színes téma). */
export const mapTheme = (look: MapLook): 'default' | 'monochrome' => (look === 'visszafogott' ? 'monochrome' : 'default');

/**
 * A térképre ténylegesen alkalmazott fény (AW16). A napszak szerinti `preset`-ből (`lightPresetAt`) napközben a
 * beállítás dönt: „Világos” = nappali fény (`day`), „Színes” = alkonyi fény (`dusk`), „Visszafogott” a napszak szerint.
 * Hajnalban, napnyugtakor és éjjel mindhárom ugyanazt kapja (alkonyban dusk, éjjel night). A térkép-rétegek (pl. az
 * alternatív útvonal színe) is ehhez igazodnak.
 */
export const mapLightPreset = (look: MapLook, preset: LightPreset): LightPreset =>
  preset === 'day' ? (look === 'szines' ? 'dusk' : 'day') : preset;

/** Erősebb üveg kell-e: csak ha a „Világos” térkép ténylegesen nappali fényben van (éjjel sötét a térkép). */
export const strongGlassFor = (look: MapLook, applied: LightPreset): boolean => look === 'vilagos' && applied === 'day';
