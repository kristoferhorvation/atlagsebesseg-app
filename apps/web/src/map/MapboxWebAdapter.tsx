import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import mapboxgl, { type GeoJSONSource, type Map as MbMap } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { mapTheme, MapStore, NAV_FOLLOW, navFollowZoom, placeAltLabel, type LightPreset, type MapLook } from '@atlagsebesseg/app-logic';
import { bearingDeg, haversineM, LocalProjection, type GpsFix, type LatLon, type Section } from '@atlagsebesseg/core';
import { color } from '@atlagsebesseg/design-tokens';
import { iconSvg } from '../ui/Icon';
import { t } from '@atlagsebesseg/app-logic';
import type { MapCamera, MapFit, MapHandlers, MapPlanned, MapReport, MapRoute, MapZone, WebMapAdapter, WebMapState } from './WebMapAdapter';

const STANDARD_STYLE = 'mapbox://styles/mapbox/standard';
const PITCH = 60;
/** „Vissza a helyemre”: a követő kamera ennyi idő alatt áll vissza. */
const RECENTER_MS = 900;
/** Az autó képernyő-helyének (focusY) simítási időállandója (ms). */
const FOCUS_TAU_MS = 150;
/** Mozdulat közben a jelzés és a nézet-frissítés ritkítása. */
const GESTURE_THROTTLE_MS = 250;
const VIEW_DEBOUNCE_MS = 500;
/** Útvonal-vonalak (A8d, px): a kiválasztott 7 + 2 × 2 fehér kontúr, az alternatíva 5 + 2 × 1,5 kontúr (nappal sötét, éjjel világos). */
const ROUTE_W = 7;
const ROUTE_CASING_W = 2;
const ROUTE_ALT_W = 5;
const ROUTE_ALT_CASING_W = 1.5;
/** Az alternatíva érintési sávja (px). */
const ROUTE_HIT_W = 28;
/** Az alternatíva színe és kontúrja a napálláshoz illő térképhez: hajnal = nappali, alkony = éjjeli (DESIGN.md). */
const isDayLike = (p: LightPreset) => p === 'day' || p === 'dawn';
const altColor = (p: LightPreset) => (isDayLike(p) ? color.routeAltDay : color.routeAltNight);
const altCasing = (p: LightPreset) => (isDayLike(p) ? color.routeAltCasingDay : color.routeAltCasingNight);

/** Mapbox GL JS v3 – Mapbox Standard stílus, autót követő 3D-s kamera. */
export class MapboxWebAdapter implements WebMapAdapter {
  private readonly store = new MapStore<WebMapState>({
    position: null,
    progress: null,
    tone: color.accent,
    focusY: 0.38,
    navFollow: false,
    lightPreset: 'night',
    look: 'szines',
    reports: [],
    selectedReportId: null,
    cameras: [],
    cameraZones: [],
    selectedCameraId: null,
    planned: [],
    activePlannedId: null,
    routes: [],
    destination: null,
    fit: null,
  });
  private readonly handlers: MapHandlers = { onGesture: () => {}, onReportTap: () => {}, onCameraTap: () => {}, onRouteTap: () => {}, onView: () => {} };
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
  setNavFollow(navFollow: boolean): void {
    this.store.set({ navFollow });
  }
  setLook(look: MapLook): void {
    this.store.set({ look });
  }
  showReports(reports: readonly MapReport[], selectedId: string | null): void {
    this.store.set({ reports, selectedReportId: selectedId });
  }
  showCameras(cameras: readonly MapCamera[], zones: readonly MapZone[], selectedId: string | null): void {
    this.store.set({ cameras, cameraZones: zones, selectedCameraId: selectedId });
  }
  showPlannedChecks(planned: readonly MapPlanned[], activeId: string | null): void {
    this.store.set({ planned, activePlannedId: activeId });
  }
  showRoutes(routes: readonly MapRoute[], destination: LatLon | null): void {
    this.store.set({ routes, destination });
  }
  fitRoute(fit: MapFit | null): void {
    // a látvány-állapotban a követő kamera pihen; a követés visszakapcsolása (followUser) animálva visszaáll
    this.store.set(fit ? { fit, follow: false } : { fit: null });
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
  /** A képernyő-közép eltolása: felül / alul ennyi px kitöltés (az autó a felső felében: alul; az alsó harmadban: felül). */
  padTop: number;
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
  /** A haladási irány átmenetének ideje (ms): navigációban rövidebb, hogy fordulásnál 300–500 ms-on belül forduljon. */
  private bearingDur = 1000;
  private lastArrival = 0;
  private lastFix: GpsFix | null = null;
  private raf = 0;
  /** A követés visszakapcsolásakor a kamera innen indul (animálva a követő pózba). */
  private recenter: { from: Camera; start: number } | null = null;
  private following = true;
  private focusY = 0.38;
  private lastFrameT = 0;
  private lastGesture = 0;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;
  private destMarker: mapboxgl.Marker | null = null;
  private readonly pins = new Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement; key: string }>();
  private readonly cams = new Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement; key: string }>();
  private readonly routeLabels = new Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement; label: NonNullable<MapRoute['label']> }>();
  /** AW17: a címkék újrahelyezése mozgáskor, képkockánként legfeljebb egyszer. */
  private labelRaf = 0;
  /** Az útvonalválasztó alsó kártyája ennyit takar (px) – a címke e fölött számol látható területtel. */
  private labelPadBottom = 0;

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
          theme: mapTheme(s.look),
          showPointOfInterestLabels: false,
          showTransitLabels: false,
          showPedestrianRoads: false,
        },
      },
    });
    this.map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: t('map.attribution') }), 'top-right');

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
    this.map.on('move', this.queueLabelPlacement);
    // a mozgás végén mindig (ha a képkocka-ütem ritka – háttérlap, headless –, a rAF-os újrahelyezés késhet)
    this.map.on('moveend', () => this.placeRouteLabels());
    this.map.on('resize', this.queueLabelPlacement);
    this.map.on('click', () => this.handlers.onReportTap(null));
    this.map.on('click', 'route-alt-hit', (e) => {
      // a közös szakaszon (a leágazás előtt) a kiválasztott vonal is ott van: ilyenkor nincs váltás
      const near: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [e.point.x - ROUTE_W, e.point.y - ROUTE_W],
        [e.point.x + ROUTE_W, e.point.y + ROUTE_W],
      ];
      if (this.map.queryRenderedFeatures(near, { layers: ['route-casing'] }).length) return;
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') this.handlers.onRouteTap(id);
    });
    this.unsubscribe = store.subscribe(() => this.apply(store.getState()));
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.labelRaf);
    clearTimeout(this.viewTimer);
    this.unsubscribe();
    for (const p of this.pins.values()) p.marker.remove();
    for (const p of this.cams.values()) p.marker.remove();
    for (const l of this.routeLabels.values()) l.marker.remove();
    this.marker.remove();
    this.destMarker?.remove();
    this.map.remove();
  }

  private addLayers(): void {
    const m = this.map;
    const s = this.store.getState();
    const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
    // tervezett útvonalak (A8, A8d): alul, hogy a szakaszok és a mérés fölötte látszódjanak. Az alternatíva tömör
    // szürkéskék, nappal sötét, éjjel világos kontúrral, a kiválasztott ALATT; a kiválasztott erős kék fehér kontúrral.
    m.addSource('routes', { type: 'geojson', data: routesGeoJson([]) });
    const alt: mapboxgl.FilterSpecification = ['==', ['get', 'selected'], false];
    const sel: mapboxgl.FilterSpecification = ['==', ['get', 'selected'], true];
    m.addLayer({
      id: 'route-alt-casing',
      type: 'line',
      source: 'routes',
      slot: 'middle',
      layout,
      filter: alt,
      paint: { 'line-color': altCasing(s.lightPreset), 'line-width': ROUTE_ALT_W + 2 * ROUTE_ALT_CASING_W, 'line-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'route-alt',
      type: 'line',
      source: 'routes',
      slot: 'middle',
      layout,
      filter: alt,
      paint: { 'line-color': altColor(s.lightPreset), 'line-width': ROUTE_ALT_W, 'line-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'routes',
      slot: 'middle',
      layout,
      filter: sel,
      paint: { 'line-color': color.routeCasing, 'line-width': ROUTE_W + 2 * ROUTE_CASING_W, 'line-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'route-main',
      type: 'line',
      source: 'routes',
      slot: 'middle',
      layout,
      filter: sel,
      paint: {
        'line-color': ['match', ['get', 'level'], 'heavy', color.over, 'moderate', color.near, color.route],
        'line-width': ROUTE_W,
        'line-emissive-strength': 1,
      },
    });
    // az érintés célja az alternatíván: széles, láthatatlan sáv (≥ 28 px, vezetés közben is eltalálható)
    m.addLayer({
      id: 'route-alt-hit',
      type: 'line',
      source: 'routes',
      slot: 'middle',
      layout,
      filter: alt,
      paint: { 'line-color': color.bg, 'line-width': ROUTE_HIT_W, 'line-opacity': 0.01 },
    });
    // tervezett mérés (A7): halvány sárga, a szakaszok alatt; a most érintett vonal teltebb
    m.addSource('planned', { type: 'geojson', data: plannedGeoJson([]) });
    // zóna (csak települést közölt a rendőrség): halvány sárga kitöltés, a vonal alatt
    m.addSource('planned-zones', { type: 'geojson', data: plannedZonesGeoJson([]) });
    m.addLayer({
      id: 'planned-zone-fill',
      type: 'fill',
      source: 'planned-zones',
      slot: 'middle',
      paint: { 'fill-color': color.planned, 'fill-opacity': ['case', ['get', 'active'], 0.22, 0.12], 'fill-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'planned-zone-line',
      type: 'line',
      source: 'planned-zones',
      slot: 'middle',
      paint: { 'line-color': color.planned, 'line-width': 1.5, 'line-opacity': ['case', ['get', 'active'], 0.7, 0.4], 'line-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'planned-line',
      type: 'line',
      source: 'planned',
      slot: 'middle',
      layout,
      paint: {
        'line-color': color.planned,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 12],
        'line-opacity': ['case', ['get', 'active'], 0.75, 0.42],
        'line-emissive-strength': 1,
      },
    });
    // kamera-zóna (`zone` láthatóság): kör, pont nélkül
    m.addSource('camera-zones', { type: 'geojson', data: zonesGeoJson([]) });
    m.addLayer({
      id: 'camera-zones-fill',
      type: 'fill',
      source: 'camera-zones',
      slot: 'middle',
      paint: { 'fill-color': color.idle, 'fill-opacity': 0.12, 'fill-emissive-strength': 1 },
    });
    m.addLayer({
      id: 'camera-zones-line',
      type: 'line',
      source: 'camera-zones',
      slot: 'middle',
      paint: { 'line-color': color.idle, 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [2, 2], 'line-emissive-strength': 1 },
    });
    m.addSource('sections', { type: 'geojson', data: toGeoJson([]), lineMetrics: true });
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

  /** Az alternatívák címkéi: kis fehér buborék (DOM-jelölő); érintésre az lesz a kiválasztott útvonal. */
  private syncRouteLabels(routes: readonly MapRoute[]): void {
    const keep = new Set<string>();
    for (const r of routes) {
      if (!r.label) continue;
      keep.add(r.id);
      let l = this.routeLabels.get(r.id);
      if (!l) {
        const el = document.createElement('button');
        el.className = 'route-label';
        el.innerHTML = '<span class="route-label-bubble"></span>';
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.handlers.onRouteTap(r.id);
        });
        const marker = new mapboxgl.Marker({ element: el, rotationAlignment: 'viewport', pitchAlignment: 'viewport' });
        l = { marker, el, label: r.label };
        this.routeLabels.set(r.id, l);
      }
      l.label = r.label;
      l.el.dataset.routeId = r.id;
      l.el.firstElementChild!.textContent = r.label.text;
      l.el.setAttribute('aria-label', r.label.aria);
      l.marker.setLngLat([r.label.at.lon, r.label.at.lat]).addTo(this.map);
    }
    for (const [id, l] of this.routeLabels) {
      if (keep.has(id)) continue;
      l.marker.remove();
      this.routeLabels.delete(id);
    }
    this.placeRouteLabels();
  }

  private queueLabelPlacement = (): void => {
    if (this.routeLabels.size === 0 || this.labelRaf) return;
    this.labelRaf = requestAnimationFrame(() => {
      this.labelRaf = 0;
      this.placeRouteLabels();
    });
  };

  /**
   * AW17: a címke a saját szakasz képernyőn legtávolabbi pontja mellé kerül (fölé / alá / balra / jobbra), nem takarja a
   * leágazást, és a lehető legkevesebbet takar az útvonalakból (`placeAltLabel`, képernyő-pixelben, az aktuális zoomon).
   * A jelölő a buborék közepére kerül (a buborék mérete a DOM-ból).
   */
  private placeRouteLabels(): void {
    if (this.routeLabels.size === 0) return;
    const c = this.map.getContainer();
    const viewport = { w: c.clientWidth, h: Math.max(1, c.clientHeight - this.labelPadBottom) };
    const proj = (p: LatLon) => {
      const q = this.map.project([p.lon, p.lat]);
      return { x: q.x, y: q.y };
    };
    for (const l of this.routeLabels.values()) {
      const bubble = l.el.firstElementChild as HTMLElement;
      const label = { w: bubble.offsetWidth || 64, h: bubble.offsetHeight || 28 };
      const place = placeAltLabel({
        own: l.label.own.map(proj),
        base: l.label.basePath.map(proj),
        alt: l.label.altPath.map(proj),
        divergence: proj(l.label.divergence),
        label,
        viewport,
      });
      if (!place) continue;
      const at = this.map.unproject([place.box.x + place.box.w / 2, place.box.y + place.box.h / 2]);
      l.el.dataset.side = place.side;
      l.marker.setLngLat(at);
    }
  }

  /** Fix kamerák: kis, visszafogott DOM-jelölők (56 px-es érintési cél, 30 px-es korong). */
  private syncCameras(cameras: readonly MapCamera[], selectedId: string | null): void {
    const keep = new Set<string>();
    for (const c of cameras) {
      keep.add(c.id);
      const key = `${c.icon}|${c.lat}|${c.lon}`;
      let pin = this.cams.get(c.id);
      if (pin && pin.key !== key) {
        pin.marker.remove();
        pin = undefined;
      }
      if (!pin) {
        const el = document.createElement('button');
        el.className = 'camera-pin';
        el.setAttribute('aria-label', c.label);
        el.innerHTML = `<span class="camera-pin-disc">${iconSvg(c.icon, 18)}</span>`;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.handlers.onCameraTap(c.id);
        });
        const marker = new mapboxgl.Marker({ element: el, rotationAlignment: 'viewport', pitchAlignment: 'viewport' })
          .setLngLat([c.lon, c.lat])
          .addTo(this.map);
        pin = { marker, el, key };
        this.cams.set(c.id, pin);
      }
      pin.el.classList.toggle('selected', c.id === selectedId);
    }
    for (const [id, pin] of this.cams) {
      if (keep.has(id)) continue;
      pin.marker.remove();
      this.cams.delete(id);
    }
  }

  /** Az úti cél jelölője. */
  private syncDestination(dest: LatLon | null): void {
    this.destMarker?.remove();
    this.destMarker = null;
    if (!dest) return;
    const el = document.createElement('div');
    el.className = 'dest-pin';
    el.setAttribute('aria-label', t('nav.dest.aria'));
    el.innerHTML = iconSvg('pin', 36);
    this.destMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom', rotationAlignment: 'viewport', pitchAlignment: 'viewport' }).setLngLat([dest.lon, dest.lat]).addTo(this.map);
  }

  /** Az útvonal(ak) a képernyőn: felülnézet, a kártyák alatt / fölött hagyott hellyel. */
  private fit(fit: MapFit): void {
    this.following = false;
    this.recenter = null;
    const b = new mapboxgl.LngLatBounds();
    for (const p of fit.points) b.extend([p.lon, p.lat]);
    this.labelPadBottom = fit.padBottom;
    this.map.fitBounds(b, { padding: { top: fit.padTop, bottom: fit.padBottom, left: 36, right: 36 }, pitch: 0, bearing: 0, duration: 900, maxZoom: 15 });
  }

  private camera(): Camera {
    const c = this.map.getCenter();
    const pad = this.map.getPadding();
    return { lat: c.lat, lon: c.lng, bearing: this.map.getBearing(), zoom: this.map.getZoom(), pitch: this.map.getPitch(), padTop: pad.top ?? 0, padBottom: pad.bottom ?? 0 };
  }

  private apply(s: WebMapState): void {
    const p = this.prev;
    // a kért téma és fény a konténeren is (AW15: a böngészős ellenőrzés ebből olvassa, nem a Mapbox belsejéből)
    const el = this.map.getContainer();
    el.dataset.theme = mapTheme(s.look);
    el.dataset.lightPreset = s.lightPreset;
    if (s.position !== p?.position && s.position) this.onPosition(s.position);
    if (s.follow !== this.following) {
      this.following = s.follow;
      this.recenter = s.follow ? { from: this.camera(), start: performance.now() } : null;
    }
    if (s.destination !== p?.destination) this.syncDestination(s.destination);
    if (s.fit && s.fit !== p?.fit) this.fit(s.fit);
    if (s.reports !== p?.reports || s.selectedReportId !== p?.selectedReportId) this.syncPins(s.reports, s.selectedReportId);
    if (s.cameras !== p?.cameras || s.selectedCameraId !== p?.selectedCameraId) this.syncCameras(s.cameras, s.selectedCameraId);
    if (s.routes !== p?.routes) this.syncRouteLabels(s.routes);
    if (!this.styleReady) return;
    const m = this.map;
    if (s.lightPreset !== p?.lightPreset) {
      m.setConfigProperty('basemap', 'lightPreset', s.lightPreset);
      m.setPaintProperty('route-alt', 'line-color', altColor(s.lightPreset));
      m.setPaintProperty('route-alt-casing', 'line-color', altCasing(s.lightPreset));
    }
    if (s.look !== p?.look) m.setConfigProperty('basemap', 'theme', mapTheme(s.look));
    if (s.sections !== p?.sections) (m.getSource('sections') as GeoJSONSource | undefined)?.setData(toGeoJson(s.sections));
    if (s.planned !== p?.planned || s.activePlannedId !== p?.activePlannedId) {
      (m.getSource('planned') as GeoJSONSource | undefined)?.setData(plannedGeoJson(s.planned, s.activePlannedId));
      (m.getSource('planned-zones') as GeoJSONSource | undefined)?.setData(plannedZonesGeoJson(s.planned, s.activePlannedId));
    }
    if (s.routes !== p?.routes) (m.getSource('routes') as GeoJSONSource | undefined)?.setData(routesGeoJson(s.routes));
    if (s.cameraZones !== p?.cameraZones) (m.getSource('camera-zones') as GeoJSONSource | undefined)?.setData(zonesGeoJson(s.cameraZones));
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
    const nav = this.store.getState().navFollow;
    // navigációban a sebességhez kötött zoom (a GPS-sebesség zaját simítva), mérésnél a korábbi görbe
    const zoom = nav
      ? this.to
        ? this.to.zoom + (navFollowZoom(kmh) - this.to.zoom) * 0.35
        : navFollowZoom(kmh)
      : clamp(17.3 - Math.max(0, kmh - 40) * 0.017, 15.5, 17.3);
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
    this.bearingDur = nav ? Math.min(this.animDur, NAV_FOLLOW.bearingMs) : this.animDur;
    this.animStart = now;
    this.lastArrival = now;
    this.lastFix = fix;
  }

  private frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.from || !this.to) return;
    const k = clamp((t - this.animStart) / this.animDur, 0, 1);
    const kb = easeOut(clamp((t - this.animStart) / this.bearingDur, 0, 1));
    const pose: Pose = {
      lat: lerp(this.from.lat, this.to.lat, k),
      lon: lerp(this.from.lon, this.to.lon, k),
      bearing: lerpAngle(this.from.bearing, this.to.bearing, kb),
      zoom: lerp(this.from.zoom, this.to.zoom, k),
    };
    this.shown = pose;
    this.marker.setLngLat([pose.lon, pose.lat]).setRotation(pose.bearing);
    const s = this.store.getState();
    // a kártya méretváltásakor az autó helye finoman, nem ugrásszerűen követi (időalapú, a képkocka-sebességtől független)
    const dt = this.lastFrameT ? Math.min(1000, t - this.lastFrameT) : 16;
    this.lastFrameT = t;
    this.focusY += (s.focusY - this.focusY) * (1 - Math.exp(-dt / FOCUS_TAU_MS));
    if (!this.following) return;
    const h = this.map.getContainer().clientHeight;
    // az autó a képernyő focusY magasságában: fölötte alul, alatta (navigáció: alsó harmad) felül tolunk
    let cam: Camera = { ...pose, pitch: PITCH, padTop: Math.max(0, 2 * this.focusY * h - h), padBottom: Math.max(0, h - 2 * this.focusY * h) };
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
      padding: { top: cam.padTop, bottom: cam.padBottom, left: 0, right: 0 },
    });
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k: number) => 1 - (1 - k) ** 2;
function blend(a: Camera, b: Camera, k: number): Camera {
  return {
    lat: lerp(a.lat, b.lat, k),
    lon: lerp(a.lon, b.lon, k),
    bearing: lerpAngle(a.bearing, b.bearing, k),
    zoom: lerp(a.zoom, b.zoom, k),
    pitch: lerp(a.pitch, b.pitch, k),
    padTop: lerp(a.padTop, b.padTop, k),
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

function routesGeoJson(routes: readonly MapRoute[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((r) =>
      r.runs.map((run) => ({
        type: 'Feature' as const,
        properties: { id: r.id, selected: r.selected, level: run.level },
        geometry: { type: 'LineString' as const, coordinates: run.points.map((p) => [p.lon, p.lat]) },
      })),
    ),
  };
}

function plannedGeoJson(planned: readonly MapPlanned[], activeId: string | null = null): FeatureCollection<MultiLineString> {
  return {
    type: 'FeatureCollection',
    features: planned
      .filter((c) => c.lines.length > 0)
      .map((c) => ({
        type: 'Feature',
        properties: { id: c.id, active: c.id === activeId },
        geometry: { type: 'MultiLineString', coordinates: c.lines.map((l) => l.map((p) => [p.lon, p.lat])) },
      })),
  };
}

/** A zóna-típusú mérések sokszögei (a település határa). */
function plannedZonesGeoJson(planned: readonly MapPlanned[], activeId: string | null = null): FeatureCollection<MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: planned
      .filter((c) => c.zones.length > 0)
      .map((c) => ({
        type: 'Feature',
        properties: { id: c.id, active: c.id === activeId },
        geometry: { type: 'MultiPolygon', coordinates: c.zones.map((poly) => poly.map((ring) => ring.map((p) => [p.lon, p.lat]))) },
      })),
  };
}

/** Körök 48 oldalú sokszögként (helyi vetületben, a sugár méterben). */
function zonesGeoJson(zones: readonly MapZone[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => {
      const proj = new LocalProjection(z.center);
      const ring = Array.from({ length: 49 }, (_, i) => {
        const a = (i / 48) * 2 * Math.PI;
        const p = proj.fromXY({ x: Math.cos(a) * z.radiusM, y: Math.sin(a) * z.radiusM });
        return [p.lon, p.lat];
      });
      return { type: 'Feature', properties: { id: z.id }, geometry: { type: 'Polygon', coordinates: [ring] } };
    }),
  };
}
