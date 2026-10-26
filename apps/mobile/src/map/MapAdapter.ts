import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Section } from '@atlagsebesseg/core';

export type LightPreset = 'dawn' | 'day' | 'dusk' | 'night';

export interface MapViewProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Térkép-absztrakció. Az app többi része CSAK ezt az interfészt használja, így a
 * Mapbox-implementáció később MapLibre-re (vagy másra) cserélhető.
 */
export interface MapAdapter {
  /** A térképet megjelenítő komponens; az állapotot az adapter metódusai vezérlik. */
  readonly MapView: ComponentType<MapViewProps>;
  /** A megjelenítendő szakaszok; `highlightId` az éppen aktív (kiemelt) szakasz. */
  showSections(sections: readonly Section[], highlightId?: string | null): void;
  /** Kamera követi-e a felhasználót (haladási irányba forgatva). */
  followUser(enabled: boolean): void;
  setLightPreset(preset: LightPreset): void;
}

/** Az adapterek közös, implementációfüggetlen állapota. */
export interface MapState {
  sections: readonly Section[];
  highlightId: string | null;
  follow: boolean;
  lightPreset: LightPreset;
}

/** Minimális külső store (useSyncExternalStore-hoz), hogy az adapter metódusai újrarendereljék a térképet. */
export class MapStore {
  private state: MapState = { sections: [], highlightId: null, follow: true, lightPreset: 'night' };
  private readonly listeners = new Set<() => void>();

  getState = (): MapState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<MapState>): void {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof MapState)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}
