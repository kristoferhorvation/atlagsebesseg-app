import type { LatLon } from '@atlagsebesseg/core';
import { haversineM } from '@atlagsebesseg/core';
import { directionsLanguage, type Lang } from '../i18n';
import { NAV_CONFIG } from './config';
import type { BannerText, Congestion, NavBanner, NavRoute, NavStep, NavVoice } from './types';

const BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic';

/**
 * A Directions-kérés címe: forgalmas profil, alternatívák, lépések, szalag- és hangutasítások, annotációk. AW18: `via`
 * (a következő manőver) néma köztes pont (`waypoints=0;2`), hogy a friss forgalmi lekérés a jelenlegi útvonalon maradjon –
 * ilyenkor alternatíva nincs (a Directions csak két pontnál ad).
 */
export function directionsUrl(
  from: LatLon,
  to: LatLon,
  lang: Lang,
  token: string,
  opts: { alternatives?: boolean; heading?: number | null; via?: LatLon | null } = {},
): string {
  const via = opts.via ?? null;
  const q = new URLSearchParams({
    alternatives: String(via ? false : (opts.alternatives ?? true)),
    steps: 'true',
    banner_instructions: 'true',
    voice_instructions: 'true',
    voice_units: 'metric',
    geometries: 'geojson',
    overview: 'full',
    annotations: 'maxspeed,congestion,duration',
    language: directionsLanguage(lang),
  });
  // újratervezésnél a haladási irány: ne küldjön vissza ellenkező irányba
  if (opts.heading !== null && opts.heading !== undefined && Number.isFinite(opts.heading)) q.set('bearings', `${Math.round(opts.heading)},45;${via ? ';' : ''}`);
  if (via) q.set('waypoints', '0;2');
  q.set('access_token', token);
  const pts = [from, ...(via ? [via] : []), to].map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  return `${BASE}/${pts}?${q}`;
}

export class DirectionsError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DirectionsError';
  }
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const bannerText = (v: unknown): BannerText | null => {
  if (!isObj(v) || typeof v.text !== 'string') return null;
  return { text: v.text, type: typeof v.type === 'string' ? v.type : 'turn', modifier: typeof v.modifier === 'string' ? v.modifier : null, exit: exitOf(v.components) };
};

/** A kijárat felirata: csak az `exit` és `exit-number` komponens („Kijárat 56”), a pajzs/sáv/egyéb nem. */
function exitOf(components: unknown): string | null {
  const parts = arr(components).flatMap((c) => (isObj(c) && (c.type === 'exit' || c.type === 'exit-number') && typeof c.text === 'string' && c.text.trim() ? [c.text.trim()] : []));
  return parts.length > 0 ? parts.join(' ') : null;
}

const KMH_PER_MPH = 1.609344;

function limitOf(v: unknown): number | null {
  if (!isObj(v) || v.unknown === true || v.none === true) return null;
  const s = num(v.speed, NaN);
  if (!Number.isFinite(s) || s <= 0) return null;
  return Math.round(v.unit === 'mph' ? s * KMH_PER_MPH : s);
}

const CONGESTION: readonly Congestion[] = ['unknown', 'low', 'moderate', 'heavy', 'severe'];
const congestionOf = (v: unknown): Congestion => (CONGESTION as readonly unknown[]).includes(v) ? (v as Congestion) : 'unknown';

/**
 * A Directions-válasz (`routes[]`) feldolgozása. A szakasz-annotációk a geometria két pontja közötti
 * szakaszokhoz tartoznak; a távolságokat az útvonal névleges hosszára skálázzuk (mint a core `Route`).
 */
export function parseDirections(json: unknown, idPrefix = 'r'): NavRoute[] {
  if (!isObj(json)) throw new DirectionsError('invalid', 'nem JSON-objektum');
  if (json.code !== undefined && json.code !== 'Ok') throw new DirectionsError(String(json.code), typeof json.message === 'string' ? json.message : undefined);
  const routes = arr(json.routes).filter(isObj);
  if (routes.length === 0) throw new DirectionsError('NoRoute');
  return routes.map((r, ri) => parseRoute(r, `${idPrefix}${ri}`));
}

function parseRoute(r: J, id: string): NavRoute {
  const coords = isObj(r.geometry) ? arr(r.geometry.coordinates) : [];
  const points: LatLon[] = coords.flatMap((c) => (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' ? [{ lat: c[1], lon: c[0] }] : []));
  if (points.length < 2) throw new DirectionsError('invalid', 'üres geometria');
  const nSeg = points.length - 1;

  // annotációk: a lábak egymás után fűzve
  const limits: (number | null)[] = [];
  const congestion: Congestion[] = [];
  const durations: number[] = [];
  const steps: NavStep[] = [];
  const rawSteps: J[] = [];
  for (const leg of arr(r.legs).filter(isObj)) {
    const a = isObj(leg.annotation) ? leg.annotation : {};
    limits.push(...arr(a.maxspeed).map(limitOf));
    congestion.push(...arr(a.congestion).map(congestionOf));
    durations.push(...arr(a.duration).map((d) => num(d)));
    rawSteps.push(...arr(leg.steps).filter(isObj));
  }

  const lens = points.slice(1).map((p, i) => haversineM(points[i]!, p));
  const geom = lens.reduce((s, x) => s + x, 0);
  const distanceM = num(r.distance, geom) || geom;
  const scale = geom > 0 ? distanceM / geom : 1;
  const durationS = num(r.duration);
  const segStartM: number[] = [];
  let cum = 0;
  for (const l of lens) {
    segStartM.push(cum);
    cum += l * scale;
  }
  // a hiányzó / rövid annotációt kitöltjük (ismeretlen határ, átlagos időarány)
  const avgDur = (i: number) => (durationS * (lens[i]! * scale)) / (distanceM || 1);
  const pad = <T,>(a: T[], f: (i: number) => T): T[] => Array.from({ length: nSeg }, (_, i) => (i < a.length ? a[i]! : f(i)));

  let startM = 0;
  rawSteps.forEach((s, i) => {
    const next = rawSteps[i + 1];
    const man = isObj(next?.maneuver) ? next.maneuver : isObj(s.maneuver) ? s.maneuver : {};
    const loc = arr(man.location);
    const banners: NavBanner[] = arr(s.bannerInstructions)
      .filter(isObj)
      .flatMap((b) => {
        const primary = bannerText(b.primary);
        return primary ? [{ distanceAlongM: num(b.distanceAlongGeometry), primary, secondary: bannerText(b.secondary), sub: bannerText(b.sub) }] : [];
      })
      .sort((a, b) => b.distanceAlongM - a.distanceAlongM);
    const voice: NavVoice[] = arr(s.voiceInstructions)
      .filter(isObj)
      .flatMap((v) => (typeof v.announcement === 'string' ? [{ distanceAlongM: num(v.distanceAlongGeometry), text: v.announcement }] : []))
      .sort((a, b) => b.distanceAlongM - a.distanceAlongM);
    const dist = num(s.distance);
    steps.push({
      index: i,
      distanceM: dist,
      durationS: num(s.duration),
      startM,
      name: typeof s.name === 'string' ? s.name : '',
      endManeuver: {
        type: typeof man.type === 'string' ? man.type : 'arrive',
        modifier: typeof man.modifier === 'string' ? man.modifier : null,
        instruction: typeof man.instruction === 'string' ? man.instruction : '',
        location: { lat: num(loc[1]), lon: num(loc[0]) },
      },
      banners,
      voice,
    });
    startM += dist;
  });
  absorbArrivalStub(steps);

  return {
    id,
    points,
    distanceM,
    durationS,
    typicalDurationS: typeof r.duration_typical === 'number' ? r.duration_typical : null,
    steps,
    segStartM,
    segLimitKmh: pad(limits, () => null),
    segCongestion: pad(congestion, () => 'unknown'),
    segDurationS: pad(durations, avgDur),
  };
}

/**
 * Az érkezés előtti csonka lépés (az érkezési küszöbnél rövidebb kanyar – pl. a sarki ház címét a Directions a
 * mellékutcára illeszti: „Forduljon jobbra az Abádi utcára” 8 m-rel a cél előtt) beolvad az érkezésbe: az előző lépés
 * vége már az érkezés, a szalagja és a hangja az érkezésé. Erre a manőverre úgysem érnénk oda (`arriveM`-nél megérkeztünk).
 * Helyben módosít.
 */
export function absorbArrivalStub(steps: NavStep[], maxM = NAV_CONFIG.arriveM): void {
  const a = steps.findIndex((s) => s.endManeuver.type === 'arrive');
  const stub = steps[a];
  const prev = steps[a - 1];
  if (!stub || !prev || stub.distanceM <= 0 || stub.distanceM >= maxM) return;
  const total = prev.distanceM + stub.distanceM;
  steps.splice(a - 1, 2, {
    ...prev,
    distanceM: total,
    durationS: prev.durationS + stub.durationS,
    endManeuver: stub.endManeuver,
    banners: stub.banners.map((b) => ({ ...b, distanceAlongM: Math.min(total, b.distanceAlongM + prev.distanceM) })),
    // az érkezés bemondása még az érkezési küszöb előtt
    voice: stub.voice.map((v) => ({ ...v, distanceAlongM: Math.min(total, Math.max(v.distanceAlongM, 2 * maxM)) })),
  });
  steps.forEach((s, i) => (s.index = i));
}

/** Szakaszindex az útvonal menti távolsághoz (bináris keresés). */
export function segmentAt(route: NavRoute, alongM: number): number {
  const s = route.segStartM;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]! <= alongM) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A sebességhatár az útvonal adott pontján (az annotációból); `null`: nincs adat. */
export const limitAt = (route: NavRoute, alongM: number): number | null => route.segLimitKmh[segmentAt(route, alongM)] ?? null;

/** Egyforma dugó-szintű, egymás melletti szakaszok csoportjai a térképi színezéshez. */
export function congestionRuns(route: NavRoute): { points: LatLon[]; level: 'normal' | 'moderate' | 'heavy' }[] {
  const level = (c: Congestion) => (c === 'moderate' ? 'moderate' : c === 'heavy' || c === 'severe' ? 'heavy' : 'normal');
  const runs: { points: LatLon[]; level: 'normal' | 'moderate' | 'heavy' }[] = [];
  route.segCongestion.forEach((c, i) => {
    const l = level(c);
    const last = runs[runs.length - 1];
    if (last && last.level === l) last.points.push(route.points[i + 1]!);
    else runs.push({ level: l, points: [route.points[i]!, route.points[i + 1]!] });
  });
  return runs;
}

/** A dugó miatti késés másodpercben (a tipikus időhöz képest), 0 alá nem megy. */
export const trafficDelayS = (route: NavRoute): number => (route.typicalDurationS === null ? 0 : Math.max(0, Math.round(route.durationS - route.typicalDurationS)));
