import type { MapAdapter } from './MapAdapter';
import { MapboxAdapter } from './MapboxAdapter';

export type { LightPreset, MapAdapter, MapViewProps } from './MapAdapter';
export { MapProvider, useMap } from './MapContext';

/**
 * Az egyetlen hely, ahol a konkrét térkép-implementáció eldől.
 * MapLibre-re váltáskor itt kell egy `MapLibreAdapter`-t visszaadni.
 */
export function createMapAdapter(accessToken: string): MapAdapter {
  return new MapboxAdapter(accessToken);
}
