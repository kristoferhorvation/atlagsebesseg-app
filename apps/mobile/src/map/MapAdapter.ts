import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { MapController } from '@atlagsebesseg/app-logic';

export { MapStore, type LightPreset, type MapState } from '@atlagsebesseg/app-logic';

export interface MapViewProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Térkép-absztrakció. Az app többi része CSAK ezt az interfészt használja, így a
 * Mapbox-implementáció később MapLibre-re (vagy másra) cserélhető. A metódusok és az állapot
 * (MapController, MapStore) közösek a webbel: @atlagsebesseg/app-logic.
 */
export interface MapAdapter extends MapController {
  /** A térképet megjelenítő komponens; az állapotot az adapter metódusai vezérlik. */
  readonly MapView: ComponentType<MapViewProps>;
}
