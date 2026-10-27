import type { FeatureCollection, LineString } from 'geojson';
import mapboxgl, { type GeoJSONSource, type Map as MbMap } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { MapStore, type LightPreset, type MapLook } from '@atlagsebesseg/app-logic';
import { bearingDeg, haversineM, type GpsFix, type Section } from '@atlagsebesseg/core';
import { color } from '@atlagsebesseg/design-tokens';
import { iconSvg } from '../ui/Icon';
import type { MapHandlers, MapReport, WebMapAdapter, WebMapState } from './WebMapAdapter';

const STANDARD_STYLE = 'mapbox://styles/mapbox/standard';
const PITCH = 60;
/** Mapbox Standard `theme` konfiguráció a beállítás szerint. */
const THEME: Record<MapLook, string> = { szines: 'default', visszafogott: 'monochrome' };
const OSM_ATTRIBUTION = 'Szakaszok © OpenStreetMap contributors (ODbL)';
/** „Vissza a helyemre”: a követő kamera ennyi idő alatt áll vissza. */
const RECENTER_MS = 900;
/** Mozdulat közben a jelzés és a nézet-frissítés ritkítása. */
const GESTURE_THROTTLE_MS = 250;
const VIEW_DEBOUNCE_MS = 500;

/** Mapbox GL JS v3 – Mapbox Standard stílus, autót követő 3D-s kamera. */
export class MapboxWebAdapter implements WebMapAdapter {
  private readonly store = new MapStore<WebMapState>({
    position: null,
    progress: null,
    tone: color.accent,
    focusY: 0.38,
    lightPreset: 'night',
    look: 'szines',
    reports: [],
    selectedReportId: null,
  });
  private readonly handlers: MapHandlers = { onGesture: () => {}, onReportTap: () => {}, onView: () => {} };
  readonly MapView: (props: { className?: string }) => React.JSX.Element;

  constructor(accessToken: string) {
    const store = this.store;
    const handlers = this.handlers;
    this.MapView = function MapboxMapView({ className }) {
      const container = useRef<HTMLDivElement>(null);
      useEffect(() => {
        if (!container.current) return;
        const controller = new MapController(container.current, accessToken, store, handlers);
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
  setLook(look: MapLook): void {
    this.store.set({ look });
  }
  showReports(reports: readonly MapReport[], selectedId: string | null): void {
    this.store.set({ reports, selectedReportId: selectedId });
  }
  setHandlers(h: Partial<MapHandlers>): void {
    Object.assign(this.handlers, h);
  }
}

interface Camera {
  lat: number;
  lon: number;
  bearing: number;
  zoom: number;
  pitch: number;
  padBottom: number;
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
  /** A követés visszakapcsolásakor a kamera innen indul (animálva a követő pózba). */
  private recenter: { from: Camera; start: number } | null = null;
  private following = true;
  private focusY = 0.38;
  private lastGesture = 0;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pins = new Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement; key: string }>();

  constructor(
    container: HTMLElement,
    accessToken: string,
    private readonly store: MapStore<WebMapState>,
    private readonly handlers: MapHandlers,
  ) {
    const s = store.getState();
    this.map = new mapboxgl.Map({
      container,
      accessToken,
      style: STANDARD_STYLE,
      center: [12.5, 46.5],
      zoom: 5.2,
      pitch: 0,
      // húzás, csípés, forgatás; a dupla koppintás nem zoomol (vezetés közben véletlen)
      interactive: true,
      doubleClickZoom: false,
      touchPitch: false,
      attributionControl: false,
      logoPosition: 'top-left',
      fadeDuration: 0,
      config: {
        basemap: {
          lightPreset: s.lightPreset,
          theme: THEME[s.look],
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
    this.map.on('movestart', this.onUserMove);
    this.map.on('move', this.onUserMove);
    this.map.on('moveend', this.onMoveEnd);
    this.map.on('click', () => this.handlers.onReportTap(null));
    this.unsubscribe = store.subscribe(() => this.apply(store.getState()));
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.viewTimer);
    this.unsubscribe();
    for (const p of this.pins.values()) p.marker.remove();
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

  /** Csak a felhasználó mozdulata (a saját `jumpTo`-nak nincs `originalEvent`-je). */
  private onUserMove = (e: { type: string; originalEvent?: unknown }): void => {
    if (!e.originalEvent) return;
    this.recenter = null;
    if (this.following) {
      // azonnal elengedjük a kamerát, ne húzza vissza a következő képkocka
      this.following = false;
      this.store.set({ follow: false });
    }
    const now = performance.now();
    if (e.type === 'movestart' || now - this.lastGesture > GESTURE_THROTTLE_MS) {
      this.lastGesture = now;
      this.handlers.onGesture();
    }
  };

  private onMoveEnd = (): void => {
    if (this.viewTimer !== undefined) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = undefined;
      const b = this.map.getBounds();
      if (b) this.handlers.onView({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    }, VIEW_DEBOUNCE_MS);
  };

  /** A bejelentés-ikonok: DOM-jelölők (56 px-es érintési cél), a képernyővel párhuzamosan állva. */
  private syncPins(reports: readonly MapReport[], selectedId: string | null): void {
    const keep = new Set<string>();
    for (const r of reports) {
      keep.add(r.id);
      const key = `${r.icon}|${r.tone}|${r.lat}|${r.lon}`;
      let pin = this.pins.get(r.id);
      if (pin && pin.key !== key) {
        pin.marker.remove();
        pin = undefined;
      }
      if (!pin) {
        const el = document.createElement('button');
        el.className = 'report-pin';
        el.dataset.tone = r.tone;
        el.setAttribute('aria-label', r.label);
        el.innerHTML = `<span class="report-pin-disc">${iconSvg(r.icon, 24)}</span>`;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.handlers.onReportTap(r.id);
        });
        const marker = new mapboxgl.Marker({ element: el, rotationAlignment: 'viewport', pitchAlignment: 'viewport' })
          .setLngLat([r.lon, r.lat])
          .addTo(this.map);
        pin = { marker, el, key };
        this.pins.set(r.id, pin);
      }
      pin.el.classList.toggle('selected', r.id === selectedId);
    }
    for (const [id, pin] of this.pins) {
      if (keep.has(id)) continue;
      pin.marker.remove();
      this.pins.delete(id);
    }
  }

  private camera(): Camera {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng, bearing: this.map.getBearing(), zoom: this.map.getZoom(), pitch: this.map.getPitch(), padBottom: this.map.getPadding().bottom ?? 0 };
  }

  private apply(s: WebMapState): void {
    const p = this.prev;
    if (s.position !== p?.position && s.position) this.onPosition(s.position);
    if (s.follow !== this.following) {
      this.following = s.follow;
      this.recenter = s.follow ? { from: this.camera(), start: performance.now() } : null;
    }
    if (s.reports !== p?.reports || s.selectedReportId !== p?.selectedReportId) this.syncPins(s.reports, s.selectedReportId);
    if (!this.styleReady) return;
    const m = this.map;
    if (s.lightPreset !== p?.lightPreset) m.setConfigProperty('basemap', 'lightPreset', s.lightPreset);
    if (s.look !== p?.look) m.setConfigProperty('basemap', 'theme', THEME[s.look]);
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
    // a kártya méretváltásakor az autó helye finoman, nem ugrásszerűen követi
    this.focusY += (s.focusY - this.focusY) * 0.12;
    if (!this.following) return;
    const h = this.map.getContainer().clientHeight;
    let cam: Camera = { ...pose, pitch: PITCH, padBottom: Math.max(0, h - 2 * this.focusY * h) };
    if (this.recenter) {
      const k = clamp((t - this.recenter.start) / RECENTER_MS, 0, 1);
      cam = blend(this.recenter.from, cam, easeInOut(k));
      if (k >= 1) this.recenter = null;
    }
    this.map.jumpTo({
      center: [cam.lon, cam.lat],
      bearing: cam.bearing,
      pitch: cam.pitch,
      zoom: cam.zoom,
      padding: { top: 0, bottom: cam.padBottom, left: 0, right: 0 },
    });
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
function blend(a: Camera, b: Camera, k: number): Camera {
  return {
    lat: lerp(a.lat, b.lat, k),
    lon: lerp(a.lon, b.lon, k),
    bearing: lerpAngle(a.bearing, b.bearing, k),
    zoom: lerp(a.zoom, b.zoom, k),
    pitch: lerp(a.pitch, b.pitch, k),
    padBottom: lerp(a.padBottom, b.padBottom, k),
  };
}
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
