import type { ComponentType } from 'react';
import type { MapController, MapLook, MapState } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';

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
}
