import { DEFAULT_TRACKER_OPTIONS, Route, type GpsFix, type LatLon } from '@atlagsebesseg/core';
import { budapestOffsetH } from '@atlagsebesseg/data/planned-parse';
import { cameraVisibility } from './cameras';
import { t, type TKey } from './i18n';

/** Tervezett rendőrségi mérés (a `planned_checks` sora appbeli alakban). */
export interface PlannedCheck {
  id: string;
  country: string;
  county: string;
  settlement: string | null;
  roadRef: string | null;
  /** A rendőrségi szöveg szó szerint. */
  description: string;
  /** Egy vagy több vonal (osztott pálya, kereszteződés); zónánál üres. */
  lines: LatLon[][];
  /**
   * Zóna (a rendőrség csak települést nevezett meg): a település közigazgatási határa, sokszögenként
   * a gyűrűk (az első a külső, a többi lyuk); vonalnál üres.
   */
  zones: LatLon[][][];
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
  geometry:
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'MultiLineString'; coordinates: [number, number][][] }
    | { type: 'Polygon'; coordinates: [number, number][][] }
    | { type: 'MultiPolygon'; coordinates: [number, number][][][] };
  speed_limit_kmh: number;
  limit_source: 'osm' | 'kresz_default';
  valid_from: string;
  valid_to: string;
  time_window: string | null;
  source_url: string;
}

export function rowToPlannedCheck(r: PlannedCheckRow): PlannedCheck {
  const ring = (l: [number, number][]) => l.map(([lon, lat]) => ({ lat, lon }));
  const g = r.geometry;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  const zones = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return {
    id: r.id,
    country: r.country,
    county: r.county,
    settlement: r.settlement,
    roadRef: r.road_ref,
    description: r.description,
    lines: lines.map(ring),
    zones: zones.map((poly) => poly.map(ring)),
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

function inRing(p: LatLon, ring: readonly LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** Zóna-típusú-e (egész település). */
export const plannedIsZone = (c: Pick<PlannedCheck, 'zones'>) => c.zones.length > 0;

/** A pont a zóna határán belül van-e (külső gyűrűben, de nem lyukban). */
export function inPlannedZone(p: LatLon, c: PlannedCheck): boolean {
  return c.zones.some(([outer, ...holes]) => !!outer && inRing(p, outer) && !holes.some((h) => inRing(p, h)));
}

/** A pont a mérés helyén van-e: vonalnál ≤ 40 m, zónánál a határon belül. */
export const onPlannedCheck = (p: LatLon, c: PlannedCheck): boolean => (plannedIsZone(c) ? inPlannedZone(p, c) : onPlannedLine(p, c));

/**
 * Melyik tervezett mérés vonalán (zónájában) halad a felhasználó: a sáv a vonalra érve azonnal megjelenik, és
 * {@link PLANNED_OFF_FIXES} vonalon kívüli fix után tűnik el (letérés). Ha vonal és zóna is érinti, a
 * vonal (a pontosabb hely) az erősebb; zónából a településen belül maradva nem tűnik el a sáv.
 */
export class PlannedCheckWatch {
  private current: PlannedCheck | null = null;
  private off = 0;

  update(fix: GpsFix | null, checks: readonly PlannedCheck[], now: number): PlannedCheck | null {
    if (!fix) return this.current;
    const active = checks.filter((c) => plannedCheckActive(c, now));
    const lineHit = active.find((c) => !plannedIsZone(c) && onPlannedCheck(fix, c)) ?? null;
    const stays = this.current && active.some((c) => c.id === this.current!.id) && onPlannedCheck(fix, this.current);
    if (stays && (!plannedIsZone(this.current!) || !lineHit)) {
      this.off = 0;
      return this.current;
    }
    const hit = lineHit ?? active.find((c) => onPlannedCheck(fix, c)) ?? null;
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

/** „okt 27–nov 2”, „ápr 15–19” (a közzétett időszak, budapesti dátum; a minta nyelvenként a szótárban). */
export function plannedDateRange(c: Pick<PlannedCheck, 'validFrom' | 'validTo'>): string {
  const [m1, d1] = localDay(c.validFrom);
  const [m2, d2] = localDay(c.validTo);
  const month = (m: number) => t(`date.month.${m}` as TKey);
  if (m1 === m2) return d1 === d2 ? t('date.range.day', { m: month(m1), d: d1 }) : t('date.range.month', { m: month(m1), d1, d2 });
  return t('date.range.months', { m1: month(m1), d1, m2: month(m2), d2 });
}

/** A határ a sávon: „max 90”, KRESZ-alapértéknél „max ~90” (nem tábla szerinti). */
export const plannedLimitText = (c: Pick<PlannedCheck, 'speedLimitKmh' | 'limitSource'>) =>
  t(c.limitSource === 'kresz_default' ? 'planned.maxApprox' : 'planned.max', { x: c.speedLimitKmh });

/** A zóna sávjában a forrás: a közlemény oldala („police.hu”). */
export function plannedSourceName(c: Pick<PlannedCheck, 'sourceUrl'>): string {
  try {
    return new URL(c.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return c.sourceUrl;
  }
}

/** Zóna-sáv: „Rendőrségi mérés {település} területén · {dátum} · forrás: {forrás}”. */
export const plannedZoneText = (c: PlannedCheck) =>
  t('planned.zone', { place: c.settlement ?? c.county, date: plannedDateRange(c), source: plannedSourceName(c) });

/** A vonalas sáv szövegrészei: „Tervezett rendőrségi mérés”, „okt 27–nov 2”, „max 90”, (időszak). */
export function plannedBandParts(c: PlannedCheck): string[] {
  return [t('planned.line'), plannedDateRange(c), plannedLimitText(c), ...(c.timeWindow ? [c.timeWindow] : [])];
}

export const plannedBandText = (c: PlannedCheck) => (plannedIsZone(c) ? plannedZoneText(c) : plannedBandParts(c).join(' · '));
