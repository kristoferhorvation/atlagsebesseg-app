import type { ComponentType } from 'react';
import type { BBox, MapController, MapLook, MapState } from '@atlagsebesseg/app-logic';
import type { GpsFix, LatLon } from '@atlagsebesseg/core';
import type { IconName } from '../ui/Icon';

/** A web-adapter állapota: a közös `MapState` + a böngészőben a GPS-t az app adja a térképnek. */
export interface WebMapState extends MapState {
  position: GpsFix | null;
  /** Az aktív szakaszon megtett hányad (0…1); `null`, ha nincs mérés. */
  progress: number | null;
  /** Az aktív szakasz színe (státuszszín). */
  tone: string;
  /** Az autó függőleges helye a képernyőn (0 = fent, 1 = lent) – a HUD fölé kerül. */
  focusY: number;
  /** Színes (Standard `default` téma) vagy visszafogott (`monochrome`). */
  look: MapLook;
  reports: readonly MapReport[];
  selectedReportId: string | null;
  cameras: readonly MapCamera[];
  cameraZones: readonly MapZone[];
  selectedCameraId: string | null;
  planned: readonly MapPlanned[];
  activePlannedId: string | null;
  routes: readonly MapRoute[];
  destination: LatLon | null;
  /** Az útvonal(ak) látványa a térképen (útvonalválasztó): a kamera ide áll, a követés kikapcsol. */
  fit: MapFit | null;
}

/** Egy tervezett útvonal a térképen: dugó szerint színezett szakaszokra bontva. */
export interface MapRoute {
  id: string;
  selected: boolean;
  runs: { points: LatLon[]; level: 'normal' | 'moderate' | 'heavy' }[];
  /** Alternatívánál a buborék a leágazás után (menetidő-különbség a kiválasztotthoz képest); egyébként `null`. */
  label: { at: LatLon; text: string; aria: string } | null;
}

export interface MapFit {
  points: readonly LatLon[];
  /** Hely a felső / alsó kártyának (px). */
  padTop: number;
  padBottom: number;
}

/** Fix kamera a térképen: kis, visszafogott ikon (a bejelentésektől eltérő stílus). */
export interface MapCamera {
  id: string;
  lat: number;
  lon: number;
  icon: IconName;
  label: string;
}

/** Kamera-zóna (`zone` láthatóság): kör a pont nélkül. */
export interface MapZone {
  id: string;
  center: LatLon;
  radiusM: number;
}

/** Tervezett mérés vonala(i) vagy zónája (a település határa): halvány sárga. */
export interface MapPlanned {
  id: string;
  lines: LatLon[][];
  /** Zóna: sokszögenként a gyűrűk (külső, majd a lyukak); vonalnál üres. */
  zones: LatLon[][][];
}

/** Egy bejelentés-ikon a térképen (ikon a webes `Icon` neve, tónus a DESIGN.md státusz-tónusa). */
export interface MapReport {
  id: string;
  lat: number;
  lon: number;
  icon: IconName;
  tone: string;
  label: string;
}

/** A térképről jövő felhasználói események. */
export interface MapHandlers {
  /** Húzás, csípés, forgatás – a mozdulat közben is (ritkítva). A követés ilyenkor azonnal kikapcsol. */
  onGesture: () => void;
  /** Koppintás egy bejelentés-ikonra; `null`: koppintás a térkép üres részére. */
  onReportTap: (id: string | null) => void;
  /** Koppintás egy kamera-ikonra (az üres térképre koppintás az `onReportTap(null)`). */
  onCameraTap: (id: string) => void;
  /** Koppintás egy alternatív útvonalra (a vonalra vagy a címkéjére): az lesz a kiválasztott. */
  onRouteTap: (id: string) => void;
  /** A látható terület (a kamera mozgása után, ritkítva). */
  onView: (bbox: BBox) => void;
}

/**
 * Térkép-absztrakció a webre: a mobil `MapAdapter` megfelelője (közös `MapController`), plusz a
 * pozíció és a mérés haladása. A Mapbox-implementáció egyetlen helyen (`createWebMapAdapter`) cserélhető.
 */
export interface WebMapAdapter extends MapController {
  readonly MapView: ComponentType<{ className?: string }>;
  setPosition(fix: GpsFix | null): void;
  setProgress(progress: number | null, tone: string): void;
  setFocusY(y: number): void;
  setLook(look: MapLook): void;
  showReports(reports: readonly MapReport[], selectedId: string | null): void;
  showCameras(cameras: readonly MapCamera[], zones: readonly MapZone[], selectedId: string | null): void;
  showPlannedChecks(planned: readonly MapPlanned[], activeId: string | null): void;
  showRoutes(routes: readonly MapRoute[], destination: LatLon | null): void;
  fitRoute(fit: MapFit | null): void;
  setHandlers(handlers: Partial<MapHandlers>): void;
}
