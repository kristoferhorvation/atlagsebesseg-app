import { DEFAULT_TRACKER_OPTIONS, Route, type GpsFix, type LatLon } from '@atlagsebesseg/core';
import { budapestOffsetH, HU_MONTH_SHORT } from '@atlagsebesseg/data/planned-parse';
import { cameraVisibility } from './cameras';

/** Tervezett rendőrségi mérés (a `planned_checks` sora appbeli alakban). */
export interface PlannedCheck {
  id: string;
  country: string;
  county: string;
  settlement: string | null;
  roadRef: string | null;
  /** A rendőrségi szöveg szó szerint. */
  description: string;
  /** Egy vagy több vonal (osztott pálya, kereszteződés). */
  lines: LatLon[][];
  speedLimitKmh: number;
  limitSource: 'osm' | 'kresz_default';
  validFrom: number;
  validTo: number;
  timeWindow: string | null;
  sourceUrl: string;
}

export interface PlannedCheckRow {
  id: string;
  country: string;
  county: string;
  settlement: string | null;
  road_ref: string | null;
  description: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'MultiLineString'; coordinates: [number, number][][] };
  speed_limit_kmh: number;
  limit_source: 'osm' | 'kresz_default';
  valid_from: string;
  valid_to: string;
  time_window: string | null;
  source_url: string;
}

export function rowToPlannedCheck(r: PlannedCheckRow): PlannedCheck {
  const coords = r.geometry.type === 'LineString' ? [r.geometry.coordinates] : r.geometry.coordinates;
  return {
    id: r.id,
    country: r.country,
    county: r.county,
    settlement: r.settlement,
    roadRef: r.road_ref,
    description: r.description,
    lines: coords.map((l) => l.map(([lon, lat]) => ({ lat, lon }))),
    speedLimitKmh: r.speed_limit_kmh,
    limitSource: r.limit_source,
    validFrom: Date.parse(r.valid_from),
    validTo: Date.parse(r.valid_to),
    timeWindow: r.time_window,
    sourceUrl: r.source_url,
  };
}

/** Ugyanaz a tűrés, mint a szakaszokra illesztésnél (core `entryCrossM`, 40 m). */
export const PLANNED_MATCH_M = DEFAULT_TRACKER_OPTIONS.entryCrossM;
/** Ennyi egymás utáni, vonalon kívüli fix után tűnik el a sáv (egy kiugró GPS-pont nem tünteti el). */
export const PLANNED_OFF_FIXES = 2;

/** Érvényes-e most, és látszhat-e az országban (a jogi láthatóság szerint). */
export const plannedCheckActive = (c: PlannedCheck, now: number) => c.validFrom <= now && now < c.validTo && cameraVisibility(c.country) !== 'hide';

const routes = new WeakMap<PlannedCheck, Route[]>();
function routesOf(c: PlannedCheck): Route[] {
  let r = routes.get(c);
  if (!r) {
    r = c.lines.filter((l) => l.length >= 2).flatMap((l) => {
      try {
        return [new Route(l)];
      } catch {
        return [];
      }
    });
    routes.set(c, r);
  }
  return r;
}

/** A pont a vonalon van-e (≤ 40 m, a két vég között – a meghosszabbításon nem). */
export function onPlannedLine(p: LatLon, c: PlannedCheck, toleranceM = PLANNED_MATCH_M): boolean {
  return routesOf(c).some((route) => {
    const proj = route.project(p);
    return proj.crossM <= toleranceM && proj.alongM >= -toleranceM && proj.alongM <= route.lengthM + toleranceM;
  });
}

/**
 * Melyik tervezett mérés vonalán halad a felhasználó: a sáv a vonalra érve azonnal megjelenik, és
 * {@link PLANNED_OFF_FIXES} vonalon kívüli fix után tűnik el (letérés).
 */
export class PlannedCheckWatch {
  private current: PlannedCheck | null = null;
  private off = 0;

  update(fix: GpsFix | null, checks: readonly PlannedCheck[], now: number): PlannedCheck | null {
    if (!fix) return this.current;
    const active = checks.filter((c) => plannedCheckActive(c, now));
    if (this.current && active.some((c) => c.id === this.current!.id) && onPlannedLine(fix, this.current)) {
      this.off = 0;
      return this.current;
    }
    const hit = active.find((c) => onPlannedLine(fix, c)) ?? null;
    if (hit) {
      this.current = hit;
      this.off = 0;
    } else if (this.current && ++this.off >= PLANNED_OFF_FIXES) {
      this.current = null;
      this.off = 0;
    }
    return this.current;
  }

  reset(): void {
    this.current = null;
    this.off = 0;
  }
}

/** Budapesti helyi dátum: [hónap 1–12, nap]. */
function localDay(t: number): [number, number] {
  const d = new Date(t + budapestOffsetH(new Date(t)) * 3600_000);
  return [d.getUTCMonth() + 1, d.getUTCDate()];
}

/** „okt 27–nov 2”, „ápr 15–19” (a közzétett időszak, budapesti dátum). */
export function plannedDateRange(c: Pick<PlannedCheck, 'validFrom' | 'validTo'>): string {
  const [m1, d1] = localDay(c.validFrom);
  const [m2, d2] = localDay(c.validTo);
  const a = `${HU_MONTH_SHORT[m1 - 1]} ${d1}`;
  if (m1 === m2) return d1 === d2 ? a : `${a}–${d2}`;
  return `${a}–${HU_MONTH_SHORT[m2 - 1]} ${d2}`;
}

/** A határ a sávon: „max 90”, KRESZ-alapértéknél „max ~90” (nem tábla szerinti). */
export const plannedLimitText = (c: Pick<PlannedCheck, 'speedLimitKmh' | 'limitSource'>) =>
  `max ${c.limitSource === 'kresz_default' ? '~' : ''}${c.speedLimitKmh}`;

/** A sáv szövegrészei: „Tervezett rendőrségi mérés”, „okt 27–nov 2”, „max 90”, (időszak). */
export function plannedBandParts(c: PlannedCheck): string[] {
  return ['Tervezett rendőrségi mérés', plannedDateRange(c), plannedLimitText(c), ...(c.timeWindow ? [c.timeWindow] : [])];
}

export const plannedBandText = (c: PlannedCheck) => plannedBandParts(c).join(' · ');
