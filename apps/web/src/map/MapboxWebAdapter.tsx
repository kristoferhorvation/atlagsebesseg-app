import type { FeatureCollection, LineString } from 'geojson';
import mapboxgl, { type GeoJSONSource, type Map as MbMap } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { MapStore, type LightPreset } from '@atlagsebesseg/app-logic';
import { bearingDeg, haversineM, type GpsFix, type Section } from '@atlagsebesseg/core';
import { color } from '@atlagsebesseg/design-tokens';
import type { WebMapAdapter, WebMapState } from './WebMapAdapter';

const STANDARD_STYLE = 'mapbox://styles/mapbox/standard';
const PITCH = 60;
const OSM_ATTRIBUTION = 'Szakaszok © OpenStreetMap contributors (ODbL)';

/** Mapbox GL JS v3 – Mapbox Standard stílus, autót követő 3D-s kamera. */
export class MapboxWebAdapter implements WebMapAdapter {
  private readonly store = new MapStore<WebMapState>({ position: null, progress: null, tone: color.accent, focusY: 0.38, lightPreset: 'night' });
  readonly MapView: (props: { className?: string }) => React.JSX.Element;

  constructor(accessToken: string) {
    const store = this.store;
    this.MapView = function MapboxMapView({ className }) {
      const container = useRef<HTMLDivElement>(null);
      useEffect(() => {
        if (!container.current) return;
        const controller = new MapController(container.current, accessToken, store);
        return () => controller.destroy();
      }, []);
      return <div ref={container} className={className} />;
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
  setPosition(fix: GpsFix | null): void {
    this.store.set({ position: fix });
  }
  setProgress(progress: number | null, tone: string): void {
    this.store.set({ progress, tone });
  }
  setFocusY(focusY: number): void {
    this.store.set({ focusY });
  }
}

interface Pose {
  lat: number;
  lon: number;
  bearing: number;
  zoom: number;
}

/** Az imperatív rész: a store változásait alkalmazza a térképre, a pozíciót 60 fps-sel animálja. */
class MapController {
  private readonly map: MbMap;
  private readonly marker: mapboxgl.Marker;
  private readonly unsubscribe: () => void;
  private styleReady = false;
  private prev: WebMapState | null = null;
  private shown: Pose | null = null;
  private from: Pose | null = null;
  private to: Pose | null = null;
  private animStart = 0;
  private animDur = 1000;
  private lastArrival = 0;
  private lastFix: GpsFix | null = null;
  private raf = 0;

  constructor(
    container: HTMLElement,
    accessToken: string,
    private readonly store: MapStore<WebMapState>,
  ) {
    const s = store.getState();
    this.map = new mapboxgl.Map({
      container,
      accessToken,
      style: STANDARD_STYLE,
      center: [12.5, 46.5],
      zoom: 5.2,
      pitch: 0,
      interactive: false,
      attributionControl: false,
      logoPosition: 'top-left',
      fadeDuration: 0,
      config: {
        basemap: {
          lightPreset: s.lightPreset,
          showPointOfInterestLabels: false,
          showTransitLabels: false,
          showPedestrianRoads: false,
        },
      },
    });
    this.map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: OSM_ATTRIBUTION }), 'top-right');

    const el = document.createElement('div');
    el.className = 'puck';
    el.innerHTML = '<div class="puck-cone"></div><div class="puck-dot"></div>';
    this.marker = new mapboxgl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([0, 0]);

    this.map.on('style.load', () => {
      this.addLayers();
      this.styleReady = true;
      this.prev = null;
      this.apply(store.getState());
    });
    this.unsubscribe = store.subscribe(() => this.apply(store.getState()));
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.marker.remove();
    this.map.remove();
  }

  private addLayers(): void {
    const m = this.map;
    m.addSource('sections', { type: 'geojson', data: toGeoJson([]), lineMetrics: true });
    const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
    m.addLayer({
      id: 'sections-line',
      type: 'line',
      source: 'sections',
      slot: 'middle',
      layout,
      paint: { 'line-color': color.accent, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 6], 'line-opacity': 0.55, 'line-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'active-glow',
      type: 'line',
      source: 'sections',
      slot: 'middle',
      layout,
      filter: ['==', ['get', 'id'], ''],
      paint: { 'line-color': color.accent, 'line-width': 26, 'line-opacity': 0.22, 'line-blur': 10, 'line-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'active-line',
      type: 'line',
      source: 'sections',
      slot: 'middle',
      layout,
      filter: ['==', ['get', 'id'], ''],
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 17, 11], 'line-color': color.accent, 'line-emissive-strength': 1 },
    });
  }

  private apply(s: WebMapState): void {
    const p = this.prev;
    if (s.position !== p?.position && s.position) this.onPosition(s.position);
    if (!this.styleReady) return;
    const m = this.map;
    if (s.lightPreset !== p?.lightPreset) m.setConfigProperty('basemap', 'lightPreset', s.lightPreset);
    if (s.sections !== p?.sections) (m.getSource('sections') as GeoJSONSource | undefined)?.setData(toGeoJson(s.sections));
    if (s.highlightId !== p?.highlightId) {
      const f: mapboxgl.FilterSpecification = ['==', ['get', 'id'], s.highlightId ?? ''];
      const others: mapboxgl.FilterSpecification = ['!=', ['get', 'id'], s.highlightId ?? ''];
      m.setFilter('active-line', f);
      m.setFilter('active-glow', f);
      m.setFilter('sections-line', others);
    }
    if (s.tone !== p?.tone || s.progress !== p?.progress) {
      m.setPaintProperty('active-glow', 'line-color', s.tone);
      const done = s.progress ?? 0;
      m.setPaintProperty('active-line', 'line-gradient', [
        'step',
        ['line-progress'],
        s.tone,
        Math.max(1e-6, done),
        withAlpha(s.tone, s.progress === null ? 0.9 : 0.38),
      ]);
    }
    this.prev = s;
  }

  private onPosition(fix: GpsFix): void {
    const now = performance.now();
    const prevFix = this.lastFix;
    let bearing = fix.heading;
    if (bearing === null && prevFix && haversineM(prevFix, fix) > 4) bearing = bearingDeg(prevFix, fix);
    bearing ??= this.to?.bearing ?? 0;
    const kmh = (fix.speed ?? 0) * 3.6;
    const zoom = clamp(17.3 - Math.max(0, kmh - 40) * 0.017, 15.5, 17.3);
    const target: Pose = { lat: fix.lat, lon: fix.lon, bearing, zoom };
    if (!this.shown) {
      this.shown = target;
      this.from = target;
      this.to = target;
      this.marker.setLngLat([fix.lon, fix.lat]).addTo(this.map);
    } else {
      this.from = this.shown;
      this.to = target;
      // az animáció a valódi érkezési ütemhez igazodik (szimulátornál gyorsított is lehet)
      this.animDur = clamp(now - this.lastArrival, 120, 1200);
    }
    this.animStart = now;
    this.lastArrival = now;
    this.lastFix = fix;
  }

  private frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.from || !this.to) return;
    const k = clamp((t - this.animStart) / this.animDur, 0, 1);
    const pose: Pose = {
      lat: lerp(this.from.lat, this.to.lat, k),
      lon: lerp(this.from.lon, this.to.lon, k),
      bearing: lerpAngle(this.from.bearing, this.to.bearing, k),
      zoom: lerp(this.from.zoom, this.to.zoom, k),
    };
    this.shown = pose;
    this.marker.setLngLat([pose.lon, pose.lat]).setRotation(pose.bearing);
    const s = this.store.getState();
    if (!s.follow) return;
    const h = this.map.getContainer().clientHeight;
    const bottom = Math.max(0, h - 2 * s.focusY * h);
    this.map.jumpTo({
      center: [pose.lon, pose.lat],
      bearing: pose.bearing,
      pitch: PITCH,
      zoom: pose.zoom,
      padding: { top: 0, bottom, left: 0, right: 0 },
    });
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function toGeoJson(sections: readonly Section[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: sections.map((s) => ({
      type: 'Feature',
      properties: { id: s.id, limit: s.speedLimitKmh },
      geometry: {
        type: 'LineString',
        coordinates: (s.geometry?.length ? s.geometry : [s.start, s.end]).map((p) => [p.lon, p.lat]),
      },
    })),
  };
}
