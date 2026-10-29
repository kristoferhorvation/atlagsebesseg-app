import type { WebMapAdapter } from './WebMapAdapter';

export type { MapFit, MapReport, MapRoute, WebMapAdapter } from './WebMapAdapter';

/**
 * Az egyetlen hely, ahol a térkép-implementáció eldől. Token nélkül egy térkép nélküli háttér
 * (a HUD és a szimulátor így is használható); a Mapbox-kód ilyenkor be sem töltődik.
 */
export async function createWebMapAdapter(accessToken: string): Promise<WebMapAdapter> {
  if (!accessToken) return new NoMapAdapter();
  const { MapboxWebAdapter } = await import('./MapboxWebAdapter');
  return new MapboxWebAdapter(accessToken);
}

/** Térkép nélküli tartalék: sötét, finom rácsos háttér. */
class NoMapAdapter implements WebMapAdapter {
  readonly MapView = ({ className }: { className?: string }) => <div className={`${className ?? ''} map-fallback`} />;
  showSections(): void {}
  followUser(): void {}
  setLightPreset(): void {}
  setPosition(): void {}
  setProgress(): void {}
  setFocusY(): void {}
  setNavFollow(): void {}
  setLook(): void {}
  showReports(): void {}
  showCameras(): void {}
  showPlannedChecks(): void {}
  showRoutes(): void {}
  fitRoute(): void {}
  setHandlers(): void {}
}
