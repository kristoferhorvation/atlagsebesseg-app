import { angleDiffDeg, haversineM, type GpsFix, type LatLon } from '@atlagsebesseg/core';
import visibilityJson from '@atlagsebesseg/data/camera_visibility.json';
import bordersJson from '@atlagsebesseg/data/country_borders.json';
import { formatDistance, speedIn, unitLabel } from './display';
import { t, type TKey } from './i18n';
import type { ReportType } from './reports';
import type { SpeedUnit } from './settings';

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

/** AOS15: a kamera-kártya irány-sora – a haladási iránytól legfeljebb `sameDirDeg`-re eső mérési irány „a te irányod”. */
export const CAMERA_CARD = { sameDirDeg: 90 } as const;

/** Mit mér a kamera hozzánk képest: irány nélküli → mindkét irány; saját irány nélkül (álló autó) csak „egy irányban”. */
export type CameraDir = 'any' | 'ours' | 'other' | 'one';

export function cameraDirection(c: Pick<FixedCamera, 'headingDeg'>, heading: number | null): CameraDir {
  if (c.headingDeg === null) return 'any';
  if (heading === null) return 'one';
  return angleDiffDeg(c.headingDeg, heading) <= CAMERA_CARD.sameDirDeg ? 'ours' : 'other';
}

/** A kártya részlet-sora: „M1 · 130 km/h” (út és limit, ami van). */
export function cameraCardDetail(c: Pick<FixedCamera, 'road' | 'speedLimitKmh'>, unit: SpeedUnit): string {
  const limit = speedIn(c.speedLimitKmh, unit);
  return [c.road, limit ? `${limit} ${unitLabel(unit)}` : null].filter(Boolean).join(' · ');
}

/** A kártya irány- és távolság-sora: „A te irányodban mér · 1,2 km távolságra” (pozíció nélkül csak az irány). */
export function cameraCardMeta(c: Pick<FixedCamera, 'headingDeg' | 'lat' | 'lon'>, fix: Pick<GpsFix, 'lat' | 'lon' | 'heading'> | null, unit: SpeedUnit): string {
  const dir = t(`camera.dir.${cameraDirection(c, fix?.heading ?? null)}` as TKey);
  if (!fix) return dir;
  const d = formatDistance(haversineM(fix, c), unit);
  return `${dir} · ${t('camera.distance', { d: `${d.value} ${d.unit}` })}`;
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

/**
 * AW25 (INV-24): az egyszeri ország-figyelmeztetések, amelyek most esedékesek – a környék kameráinak / méréseinek országaiból,
 * a már látott országok nélkül (DE: „a vezető nem használhatja”). A „látott” tárolása platformonként (web: localStorage, iOS:
 * UserDefaults, `figyelmeztetes:<ország>`), készülékenként egyszer.
 */
export function pendingCountryWarnings(countries: Iterable<string>, seen: (country: string) => boolean): { country: string; text: string }[] {
  const out: { country: string; text: string }[] = [];
  for (const country of [...new Set([...countries].map((c) => c.toUpperCase()))].sort()) {
    const text = cameraWarning(country);
    if (text && !seen(country)) out.push({ country, text });
  }
  return out;
}

/** AW25 (INV-24): a `zone` mód felirata a térképen (a pontos hely helyett), az aktuális nyelven. */
export const cameraZoneLabel = (): string => t('camera.zone');

/** A zóna sugara (`zone` mód): a pont helyett ±1 km. */
export const CAMERA_ZONE_RADIUS_M = 1000;

/**
 * A megjelenítendő kamerák a láthatóság szerint: `hide` kimarad, `zone` csak zónaként (a pont
 * nem kerül a térképre), `show` pontként. A zóna középpontja 500 m-es rácsra kerekített, hogy a
 * zónából ne lehessen a pontos helyet visszaszámolni.
 */
export function visibleCameras(cameras: readonly FixedCamera[]): { points: FixedCamera[]; zones: { id: string; center: LatLon; radiusM: number; label: string }[] } {
  const points: FixedCamera[] = [];
  const zones = new Map<string, { id: string; center: LatLon; radiusM: number; label: string }>();
  for (const c of cameras) {
    const mode = cameraVisibility(c.country);
    if (mode === 'show') points.push(c);
    else if (mode === 'zone') {
      const center = snap({ lat: c.lat, lon: c.lon }, 500);
      const id = `zone-${center.lat.toFixed(4)}-${center.lon.toFixed(4)}`;
      zones.set(id, { id, center, radiusM: CAMERA_ZONE_RADIUS_M, label: cameraZoneLabel() });
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

// ---------------------------------------------------------------------------
// AW25b (INV-26): a közösségi „Rendőrség” és „Traffipax” bejelentés ugyanazzal az országonkénti szabállyal
// ---------------------------------------------------------------------------

/** A szabály alá eső bejelentés-típusok: a rendőri ellenőrzés és a mobil traffipax (a többi típust nem érinti). */
export const ENFORCEMENT_REPORTS: readonly ReportType[] = ['rendorseg', 'traffipax'];
export const isEnforcementReport = (type: ReportType): boolean => ENFORCEMENT_REPORTS.includes(type);

type Ring = readonly (readonly [number, number])[];
interface Border {
  country: string;
  box: { west: number; east: number; south: number; north: number };
  rings: Ring[];
}

/** A nem alapértelmezett szabályú országok határa (`country_borders.json`, Natural Earth, ~150 m-es egyszerűsítés). */
const BORDERS: Border[] = Object.entries((bordersJson as unknown as { countries: Record<string, Ring[][]> }).countries).flatMap(([country, polys]) =>
  polys.map((rings) => {
    const outer = rings[0]!;
    const lons = outer.map((p) => p[0]);
    const lats = outer.map((p) => p[1]);
    return { country, box: { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) }, rings };
  }),
);

function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A pont országa, ha az a nem alapértelmezett szabályú országok egyike (DE, FR, CH); különben `null` (= alapszabály, pont).
 * A bejelentésnek nincs ország-mezője, ezért a koordinátából – a határ mentén ~150 m-es a tévedés.
 */
export function restrictedCountryAt(p: LatLon): string | null {
  for (const b of BORDERS) {
    if (p.lon < b.box.west || p.lon > b.box.east || p.lat < b.box.south || p.lat > b.box.north) continue;
    if (inRing(b.rings[0]!, p.lon, p.lat) && !b.rings.slice(1).some((h) => inRing(h, p.lon, p.lat))) return b.country;
  }
  return null;
}

/**
 * A megjelenítendő bejelentések (INV-26, a kamerák szabálya szerint): a `rendorseg` / `traffipax` az országa szerint –
 * `hide` (CH) kimarad, `zone` (FR) csak a kamerákéval azonos, 500 m-es rácsra kerekített „Ellenőrzési zóna” (a pont, a kártya,
 * a közeledés-jelzés és az útvonal-panel nem kapja meg), `show` pontként; a többi típus változatlanul. A `countries` a pontként
 * megmaradt, szabály alá eső bejelentések országai – az egyszeri figyelmeztetéshez (DE).
 */
export function visibleReports<R extends { type: ReportType; lat: number; lon: number }>(
  reports: readonly R[],
): { points: R[]; zones: { id: string; center: LatLon; radiusM: number; label: string }[]; countries: string[] } {
  const points: R[] = [];
  const zones = new Map<string, { id: string; center: LatLon; radiusM: number; label: string }>();
  const countries = new Set<string>();
  for (const r of reports) {
    const country = isEnforcementReport(r.type) ? restrictedCountryAt(r) : null;
    const mode = country ? cameraVisibility(country) : 'show';
    if (mode === 'show') {
      points.push(r);
      if (country) countries.add(country);
    } else if (mode === 'zone') {
      const center = snap({ lat: r.lat, lon: r.lon }, 500);
      const id = `zone-${center.lat.toFixed(4)}-${center.lon.toFixed(4)}`;
      zones.set(id, { id, center, radiusM: CAMERA_ZONE_RADIUS_M, label: cameraZoneLabel() });
    }
  }
  return { points, zones: [...zones.values()], countries: [...countries].sort() };
}

/** Két zóna-lista egyesítése (kamera + bejelentés): az azonos rács-cellájú zóna egyszer. */
export function mergeZones<Z extends { id: string }>(a: readonly Z[], b: readonly Z[]): Z[] {
  const seen = new Set(a.map((z) => z.id));
  return [...a, ...b.filter((z) => !seen.has(z.id))];
}
