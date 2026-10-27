import type { Section } from '@atlagsebesseg/core';
import type { LightPreset } from './lightPreset';

/**
 * A térkép-adapterek platformfüggetlen része. Az app CSAK ezt (és a platform saját `MapView`
 * komponensét) látja, így a Mapbox-implementáció később MapLibre-re (vagy másra) cserélhető.
 */
export interface MapController {
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
export class MapStore<S extends MapState = MapState> {
  private state: S;
  private readonly listeners = new Set<() => void>();

  constructor(initial?: Partial<S>) {
    this.state = { sections: [], highlightId: null, follow: true, lightPreset: 'day', ...initial } as S;
  }

  getState = (): S => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<S>): void {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof S)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}
