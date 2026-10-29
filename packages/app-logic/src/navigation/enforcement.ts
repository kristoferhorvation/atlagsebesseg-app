import { angleDiffDeg, haversineM, Route, type LatLon, type Section } from '@atlagsebesseg/core';
import { cameraVisibility, type FixedCamera } from '../cameras';
import { onPlannedCheck, plannedCheckActive, type PlannedCheck } from '../plannedChecks';
import { NAV_CONFIG } from './config';
import type { EnforcementItem, NavRoute } from './types';

export interface EnforcementData {
  sections: readonly Section[];
  cameras: readonly FixedCamera[];
  planned: readonly PlannedCheck[];
}

export const NO_ENFORCEMENT_DATA: EnforcementData = { sections: [], cameras: [], planned: [] };

/** Az útvonal befoglaló téglalapja `padM` méterrel megtoldva (gyors előszűrés). */
function bounds(points: readonly LatLon[], padM: number) {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const p of points) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
  }
  const dLat = padM / 111_195;
  const dLon = padM / (111_195 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return { s: s - dLat, n: n + dLat, w: w - dLon, e: e + dLon };
}

type Box = ReturnType<typeof bounds>;
const inBox = (p: LatLon, b: Box) => p.lat >= b.s && p.lat <= b.n && p.lon >= b.w && p.lon <= b.e;

/**
 * Az útvonal `bandM` (alapból `ROUTE_MATCH_M`, 40 m) sávjába eső szakaszok, kamerák és tervezett mérések, az útvonal menti
 * sorrendben. Szakasz: a kezdő- és a végpontja is a sávban, a haladási iránnyal egyezően;
 * kamera: csak ha a láthatósága `show` (zóna / rejtett országban a pontos hely nem kerül ki);
 * tervezett mérés: az útvonal 50 m-enként mintavételezett pontjai a vonalon (szintén `bandM`, nem a sáv
 * 100 m-es `PLANNED_MATCH_M`-je) / zónában.
 */
export function routeEnforcement(navRoute: NavRoute, data: EnforcementData, now: number, bandM = NAV_CONFIG.enforcementBandM): EnforcementItem[] {
  const route = new Route(navRoute.points, navRoute.distanceM);
  const box = bounds(navRoute.points, bandM + 100);
  const items: EnforcementItem[] = [];

  for (const s of data.sections) {
    if (!inBox(s.start, box) || !inBox(s.end, box)) continue;
    const a = route.project(s.start);
    const b = route.project(s.end);
    if (a.crossM > bandM || b.crossM > bandM) continue;
    const len = b.alongM - a.alongM;
    // a haladási iránnyal egyező, nagyjából a szakasz hosszának megfelelő útvonal-darab
    if (len < s.lengthM * 0.5 || len > s.lengthM * 2) continue;
    if (s.geometry && s.geometry.length > 2) {
      const mid = s.geometry[Math.floor(s.geometry.length / 2)]!;
      if (route.project(mid).crossM > bandM) continue;
    }
    items.push({ kind: 'section', id: s.id, startM: a.alongM, endM: b.alongM, limitKmh: s.speedLimitKmh, label: s.road });
  }

  for (const c of data.cameras) {
    if (cameraVisibility(c.country) !== 'show' || !inBox(c, box)) continue;
    const p = route.project(c);
    if (p.crossM > bandM || p.alongM < 0 || p.alongM > route.lengthM) continue;
    // az ellenkező irányba néző kamerát nem vesszük az útra (ha van irány)
    if (c.headingDeg !== null && angleDiffDeg(c.headingDeg, p.bearingDeg) > 100) continue;
    items.push({ kind: 'camera', id: c.id, startM: p.alongM, endM: p.alongM, limitKmh: c.speedLimitKmh, label: c.road, verified: c.verified });
  }

  const samples: { along: number; p: LatLon }[] = [];
  for (let d = 0; d <= route.lengthM; d += 50) samples.push({ along: d, p: route.pointAt(d) });
  for (const c of data.planned) {
    if (!plannedCheckActive(c, now)) continue;
    let from: number | null = null;
    let to = 0;
    for (const s of samples) {
      if (onPlannedCheck(s.p, c, bandM)) {
        from ??= s.along;
        to = s.along;
      }
    }
    if (from !== null) items.push({ kind: 'planned', id: c.id, startM: from, endM: to, limitKmh: c.speedLimitKmh, label: c.roadRef ?? c.settlement ?? '' });
  }

  return items.sort((x, y) => x.startM - y.startM || x.endM - y.endM);
}

/** Az `i`. szakasz átlagos haladási ideje a szakaszokon a határ szerint (mérésnél nem lehet a határnál gyorsabban menni). */
export function adjustedDurations(route: NavRoute, items: readonly EnforcementItem[]): number[] {
  const out = [...route.segDurationS];
  const sections = items.filter((x) => x.kind === 'section' && x.limitKmh && x.endM > x.startM);
  if (sections.length === 0) return out;
  const total = route.distanceM;
  for (let i = 0; i < out.length; i++) {
    const a = route.segStartM[i]!;
    const b = i + 1 < route.segStartM.length ? route.segStartM[i + 1]! : total;
    const len = b - a;
    if (len <= 0) continue;
    for (const s of sections) {
      const overlap = Math.min(b, s.endM) - Math.max(a, s.startM);
      if (overlap <= 0) continue;
      const part = (out[i]! * overlap) / len;
      const atLimit = overlap / (s.limitKmh! / 3.6);
      out[i] = out[i]! - part + Math.max(part, atLimit);
    }
  }
  return out;
}

/** Kumulált idő (s) a szakaszok elején; az utolsó elem az összes idő. */
export function cumulative(durations: readonly number[]): number[] {
  const cum = [0];
  for (const d of durations) cum.push(cum[cum.length - 1]! + d);
  return cum;
}

/** A hátralévő idő (s) az adott útvonal menti pozíciótól, a `cum` (kumulált) idő-tömbből. */
export function remainingSeconds(route: NavRoute, cum: readonly number[], alongM: number): number {
  const total = cum[cum.length - 1]!;
  if (alongM <= 0) return total;
  if (alongM >= route.distanceM) return 0;
  let lo = 0;
  let hi = route.segStartM.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (route.segStartM[mid]! <= alongM) lo = mid;
    else hi = mid - 1;
  }
  const a = route.segStartM[lo]!;
  const b = lo + 1 < route.segStartM.length ? route.segStartM[lo + 1]! : route.distanceM;
  const frac = b > a ? (alongM - a) / (b - a) : 0;
  return total - (cum[lo]! + (cum[lo + 1]! - cum[lo]!) * frac);
}

/** Két útvonal átfedése: az `b` pontjainak hányada, amely `a` 60 m-es sávjában van (kb. 1 km-enként mintázva). */
export function routeOverlap(a: NavRoute, b: NavRoute, bandM = 60): number {
  const ra = new Route(a.points, a.distanceM);
  const rb = new Route(b.points, b.distanceM);
  let hit = 0;
  let n = 0;
  for (let d = 0; d <= rb.lengthM; d += 1000) {
    n++;
    if (ra.project(rb.pointAt(d)).crossM <= bandM) hit++;
  }
  return n ? hit / n : 0;
}


/** Ezek a manőver-típusok nem jelentenek leágazást (a lépések tagolásából is adódhatnak). */
const NOT_AN_EXIT = new Set(['depart', 'arrive', 'continue', 'new name', 'notification']);

/** Két manőver „ugyanaz”, ha ilyen közel van egymáshoz (m). */
const SAME_MANEUVER_M = 35;

/**
 * Az alternatíva lehajtója: az alternatíva első manővere, amely a jelenlegi útvonal lépései között
 * nincs (a helye alapján). `distanceM` az alternatíva mentén mért távolság a kezdőpontjától – az
 * alternatívát a jelenlegi pozícióról kérjük, tehát ez a pozíciótól számít; `name` a manőver
 * kijárat-felirata („Kijárat 56”), ennek hiányában a cél-neve (a banner másodlagos szövege); egyébként `null`. `null`, ha nincs ilyen manőver.
 */
export function firstNewManeuver(current: NavRoute, alt: NavRoute): { distanceM: number; name: string | null } | null {
  for (const step of alt.steps) {
    const m = step.endManeuver;
    if (NOT_AN_EXIT.has(m.type)) continue;
    if (!m.location || current.steps.some((c) => c.endManeuver.location && haversineM(c.endManeuver.location, m.location) <= SAME_MANEUVER_M)) continue;
    return { distanceM: step.startM + step.distanceM, name: step.banners[0]?.primary.exit || step.banners[0]?.secondary?.text || null };
  }
  return null;
}
