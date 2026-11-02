import type { StyleSpecification } from 'mapbox-gl';

/**
 * Csak a böngészős ellenőrzéshez (scripts/nav-shots.mjs): a szkript a lap betöltése előtt beállítja a `window.__mapTest`-et.
 * `blank`: üres helyi stílus (nincs tile-letöltés, 3D épület, terrain) – az app logikáját mérő ellenőrzésekhez;
 * `real`: a valódi stílus, de 2D (nincs 3D épület) – a térképet magát mérő ellenőrzésekhez;
 * nincs beállítva (éles használat, képkészítés): változatlan.
 */
export type MapTestMode = 'blank' | 'real';

export const mapTestMode = (): MapTestMode | null => {
  const m = (globalThis as { __mapTest?: unknown }).__mapTest;
  return m === 'blank' || m === 'real' ? m : null;
};

const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0b0d12' } }],
};

/** A stílus és a hozzá tartozó alap-konfiguráció (a Standard `basemap` importot az üres stílus nem ismeri). */
export function mapStyleFor(
  standard: string,
  basemap: Record<string, unknown>,
): { style: string | StyleSpecification; config?: { basemap: Record<string, unknown> }; blank: boolean } {
  const mode = mapTestMode();
  if (mode === 'blank') return { style: BLANK_STYLE, blank: true };
  return { style: standard, config: { basemap: mode === 'real' ? { ...basemap, show3dObjects: false } : basemap }, blank: false };
}
