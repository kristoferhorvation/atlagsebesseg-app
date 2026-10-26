import { createContext, useContext, type ReactNode } from 'react';
import type { MapAdapter } from './MapAdapter';

const MapContext = createContext<MapAdapter | null>(null);

export function MapProvider({ adapter, children }: { adapter: MapAdapter; children: ReactNode }) {
  return <MapContext.Provider value={adapter}>{children}</MapContext.Provider>;
}

export function useMap(): MapAdapter {
  const adapter = useContext(MapContext);
  if (!adapter) throw new Error('useMap: hiányzó MapProvider');
  return adapter;
}
