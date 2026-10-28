import type { LatLon } from '@atlagsebesseg/core';
import visibilityJson from '@atlagsebesseg/data/camera_visibility.json';
import { t, type TKey } from './i18n';

/** Fix kamera (a `cameras` tábla sora appbeli alakban). */
export type CameraType = 'speed' | 'red_light' | 'complex' | 'section_gate';

export interface FixedCamera {
  id: string;
  country: string;
  type: CameraType;
  lat: number;
  lon: number;
  headingDeg: number | null;
  road: string;
  speedLimitKmh: number | null;
  source: string;
  sourceUrl: string;
  sourceDate: string;
  verified: boolean;
}

export interface CameraRow {
  id: string;
  country: string;
  type: CameraType;
  lat: number;
  lng: number;
  heading: number | null;
  road: string;
  speed_limit_kmh: number | null;
  source: string;
  source_url: string;
  source_date: string;
  verified: boolean;
}

export function rowToCamera(r: CameraRow): FixedCamera {
  return {
    id: r.id,
    country: r.country,
    type: r.type,
    lat: r.lat,
    lon: r.lng,
    headingDeg: r.heading,
    road: r.road,
    speedLimitKmh: r.speed_limit_kmh,
    source: r.source,
    sourceUrl: r.source_url,
    sourceDate: r.source_date,
    verified: r.verified,
  };
}

/** A kamera típusának felirata az aktuális nyelven. */
export const cameraLabel = (type: CameraType): string => t(`camera.type.${type}` as TKey);

/** A kártya forrás-sora: honnan tudjuk, és mennyire biztos. */
export function cameraSourceText(c: Pick<FixedCamera, 'verified' | 'type' | 'sourceDate' | 'country'>): string {
  if (c.verified && c.type === 'complex' && c.country === 'HU') return t('camera.source.veda');
  if (c.verified) return t('camera.source.official', { date: c.sourceDate });
  return t('camera.source.osm', { date: c.sourceDate });
}

// ---------------------------------------------------------------------------
// Jogi láthatóság országonként (packages/data/camera_visibility.json)
// ---------------------------------------------------------------------------

export type CameraVisibility = 'show' | 'zone' | 'hide';

interface VisibilityFile {
  default: CameraVisibility;
  countries: Record<string, { mode: CameraVisibility; warning?: TKey }>;
}

const VISIBILITY = visibilityJson as VisibilityFile;

/** A kamera- és a tervezett-mérés réteg megjelenítése az adott országban (a szakaszokat nem érinti). */
export function cameraVisibility(country: string): CameraVisibility {
  return VISIBILITY.countries[country.toUpperCase()]?.mode ?? VISIBILITY.default;
}

/** Egyszeri figyelmeztetés szövege az országra (DE), ha van – az aktuális nyelven (a JSON a szótár kulcsát adja). */
export function cameraWarning(country: string): string | null {
  const key = VISIBILITY.countries[country.toUpperCase()]?.warning;
  return key ? t(key) : null;
}

/** A zóna sugara (`zone` mód): a pont helyett ±1 km. */
export const CAMERA_ZONE_RADIUS_M = 1000;

/**
 * A megjelenítendő kamerák a láthatóság szerint: `hide` kimarad, `zone` csak zónaként (a pont
 * nem kerül a térképre), `show` pontként. A zóna középpontja 500 m-es rácsra kerekített, hogy a
 * zónából ne lehessen a pontos helyet visszaszámolni.
 */
export function visibleCameras(cameras: readonly FixedCamera[]): { points: FixedCamera[]; zones: { id: string; center: LatLon; radiusM: number }[] } {
  const points: FixedCamera[] = [];
  const zones = new Map<string, { id: string; center: LatLon; radiusM: number }>();
  for (const c of cameras) {
    const mode = cameraVisibility(c.country);
    if (mode === 'show') points.push(c);
    else if (mode === 'zone') {
      const center = snap({ lat: c.lat, lon: c.lon }, 500);
      const id = `zone-${center.lat.toFixed(4)}-${center.lon.toFixed(4)}`;
      zones.set(id, { id, center, radiusM: CAMERA_ZONE_RADIUS_M });
    }
  }
  return { points, zones: [...zones.values()] };
}

function snap(p: LatLon, stepM: number): LatLon {
  const dLat = stepM / 111_195;
  const lat = Math.round(p.lat / dLat) * dLat;
  // a hosszúsági lépés a kerekített szélességből – így a szomszédos pontok ugyanarra a rácsra esnek
  const dLon = stepM / (111_195 * Math.cos((lat * Math.PI) / 180));
  return { lat, lon: Math.round(p.lon / dLon) * dLon };
}
