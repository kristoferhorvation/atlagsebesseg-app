import { sunPhase, type SunPhase } from '@atlagsebesseg/core';

/** A Mapbox Standard stílus fény-előbeállítása. */
export type LightPreset = 'dawn' | 'day' | 'dusk' | 'night';
export type ColorScheme = 'light' | 'dark' | null | undefined;

/**
 * Térkép-előbeállítás a helyi napszakból és a rendszer világos/sötét módjából.
 * - Világos mód: a napszak dönt (nappal → day, hajnal → dawn, alkony → dusk, éjszaka → night).
 * - Sötét mód: sosem világos – nappal is `dusk`, szürkületben és éjjel `night`.
 * - Helyzet nélkül (még nincs GPS): csak a rendszer módja (sötét → night, világos → day).
 */
export function chooseLightPreset(phase: SunPhase | null, scheme: ColorScheme): LightPreset {
  const dark = scheme === 'dark';
  if (!phase) return dark ? 'night' : 'day';
  if (dark) return phase === 'nappal' ? 'dusk' : 'night';
  return ({ nappal: 'day', hajnal: 'dawn', alkony: 'dusk', ejszaka: 'night' } as const)[phase];
}

/** Előbeállítás egy időpontra és helyre (helyzet nélkül csak a rendszer módja számít). */
export function lightPresetAt(nowMs: number, pos: { lat: number; lon: number } | null, scheme: ColorScheme): LightPreset {
  return chooseLightPreset(pos ? sunPhase(nowMs, pos.lat, pos.lon) : null, scheme);
}
