import Mapbox from '@rnmapbox/maps';
import { useMemo, useSyncExternalStore } from 'react';
import type { Section } from '@atlagsebesseg/core';
import { MapStore, type LightPreset, type MapAdapter, type MapViewProps } from './MapAdapter';

const STANDARD_STYLE = 'mapbox://styles/mapbox/standard';

/** Mapbox-implementáció (@rnmapbox/maps, Mapbox Standard stílus). */
export class MapboxAdapter implements MapAdapter {
  private readonly store = new MapStore();
  readonly MapView: (props: MapViewProps) => React.JSX.Element;

  constructor(accessToken: string) {
    void Mapbox.setAccessToken(accessToken);
    const store = this.store;

    this.MapView = function MapboxMapView({ style }: MapViewProps) {
      const { sections, highlightId, follow, lightPreset } = useSyncExternalStore(store.subscribe, store.getState);
      const shape = useMemo(() => sectionsToGeoJson(sections), [sections]);
      return (
        <Mapbox.MapView style={style} styleURL={STANDARD_STYLE} scaleBarEnabled={false} logoPosition={{ bottom: 8, left: 8 }}>
          <Mapbox.StyleImport id="basemap" existing config={{ lightPreset }} />
          <Mapbox.Camera
            followUserLocation={follow}
            followUserMode={Mapbox.UserTrackingMode.FollowWithCourse}
            followZoomLevel={13}
            defaultSettings={{ centerCoordinate: [12.5, 45.5], zoomLevel: 5 }}
          />
          <Mapbox.LocationPuck puckBearing="course" puckBearingEnabled />
          <Mapbox.ShapeSource id="sections" shape={shape}>
            <Mapbox.LineLayer
              id="sections-line"
              slot="middle"
              style={{
                lineColor: ['case', ['==', ['get', 'id'], highlightId ?? ''], '#ff9f0a', '#0a84ff'],
                lineWidth: ['case', ['==', ['get', 'id'], highlightId ?? ''], 7, 4],
                lineCap: 'round',
                lineJoin: 'round',
                lineEmissiveStrength: 1,
              }}
            />
          </Mapbox.ShapeSource>
        </Mapbox.MapView>
      );
    };
  }

  showSections(sections: readonly Section[], highlightId: string | null = null): void {
    this.store.set({ sections, highlightId });
  }

  followUser(enabled: boolean): void {
    this.store.set({ follow: enabled });
  }

  setLightPreset(preset: LightPreset): void {
    this.store.set({ lightPreset: preset });
  }
}

function sectionsToGeoJson(sections: readonly Section[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: sections.map((s) => ({
      type: 'Feature',
      id: s.id,
      properties: { id: s.id, limit: s.speedLimitKmh },
      geometry: {
        type: 'LineString',
        coordinates: (s.geometry?.length ? s.geometry : [s.start, s.end]).map((p) => [p.lon, p.lat]),
      },
    })),
  };
}
