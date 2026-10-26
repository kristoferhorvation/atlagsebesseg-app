import { angleDiffDeg, bearingDeg, haversineM } from './geo';
import { DEFAULT_FIX_FILTER, FixFilter, type FixFilterOptions } from './fixFilter';
import { averageSpeedKmh, mpsToKmh, requiredSpeed, slowDownByKmh, type RequiredSpeed } from './metrics';
import { Route, type RouteProjection } from './route';
import type { GpsFix, Section } from './types';

export type TrackerState = 'nincs_szakasz' | 'kozeledik' | 'szakaszon' | 'kesz' | 'megszakadt';

/** Miért szakadt meg a mérés. */
export type AbortReason = 'letert' | 'ellenirany' | 'jelvesztes';

export interface TrackerOptions {
  /** Ennyi méterrel a kezdőpont előtt jelezzük a közeledést. */
  approachRadiusM: number;
  /** Közeledéskor megengedett távolság az útvonal (első szakaszának meghosszabbítása) vonalától. */
  approachCrossM: number;
  /** Kapuzóna: a kezdőpont utáni ennyi méteren belül még beléptetünk. */
  gateZoneM: number;
  /** Belépéskor megengedett merőleges távolság az útvonaltól (párhuzamos út szűrése). */
  entryCrossM: number;
  /** Belépéskor megengedett eltérés a haladási irány és az útvonal iránya között (ellenirány szűrése). */
  maxHeadingDiffDeg: number;
  /** Szakaszon ennél messzebb az útvonaltól: letérés-gyanú. */
  offRouteCrossM: number;
  /** Letérés: legalább ennyi egymást követő fix … */
  offRouteMinFixes: number;
  /** … és legalább ennyi idő (ms). */
  offRouteMinMs: number;
  /** Ennél nagyobb irányeltérés szakaszon: ellenirány-gyanú. */
  wrongWayDiffDeg: number;
  wrongWayMinFixes: number;
  /** Ennél hosszabb jelkiesés után a mérés megszakad (ms). */
  maxGapMs: number;
  /** Ennyi idő fix nélkül után a megtett utat becsüljük (ms). */
  estimateAfterMs: number;
  /** A GPS-irányszöget csak ennél nagyobb sebességnél vesszük figyelembe (m/s). */
  minHeadingSpeedMps: number;
  /** Lásd `requiredSpeed`. */
  minPracticalKmh: number;
  /** Kész/megszakadt állapot ennyi ideig marad látható (ms), utána `nincs_szakasz`. */
  resultHoldMs: number;
  fixFilter: FixFilterOptions;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  approachRadiusM: 2000,
  approachCrossM: 100,
  gateZoneM: 150,
  entryCrossM: 40,
  maxHeadingDiffDeg: 45,
  offRouteCrossM: 60,
  offRouteMinFixes: 5,
  offRouteMinMs: 5000,
  wrongWayDiffDeg: 135,
  wrongWayMinFixes: 5,
  maxGapMs: 15 * 60_000,
  estimateAfterMs: 3000,
  minHeadingSpeedMps: 3,
  minPracticalKmh: 60,
  resultHoldMs: 60_000,
  fixFilter: DEFAULT_FIX_FILTER,
};

export interface LiveMetrics {
  /** Megtett út a szakaszon (m). */
  distanceM: number;
  remainingM: number;
  elapsedMs: number;
  averageKmh: number | null;
  currentKmh: number | null;
  required: RequiredSpeed;
  /** Mennyivel kell lassítani a jelenlegi sebességhez képest (km/h). */
  slowDownKmh: number | null;
  /** Igaz, ha a megtett út becsült (jelkiesés, pl. alagút). */
  estimated: boolean;
}

export interface SectionResult {
  sectionId: string;
  entryTime: number;
  exitTime: number;
  lengthM: number;
  averageKmh: number;
  speedLimitKmh: number;
  overLimit: boolean;
}

export interface Transition {
  from: TrackerState;
  to: TrackerState;
  sectionId: string | null;
  at: number;
}

export interface TrackerSnapshot {
  state: TrackerState;
  /** Közeledéskor, szakaszon és kész/megszakadt állapotban az érintett szakasz. */
  section: Section | null;
  live: LiveMetrics | null;
  lastResult: SectionResult | null;
  abortReason: AbortReason | null;
  /** Az utolsó `update`/`tick` hívás alatti állapotváltások. */
  transitions: Transition[];
}

interface Prepared {
  section: Section;
  route: Route;
}

interface Active {
  entryTime: number;
  lastAlongM: number;
  lastAcceptedTime: number;
  lastSpeedMps: number | null;
  history: { t: number; along: number }[];
  offRouteCount: number;
  offRouteSince: number | null;
  wrongWayCount: number;
}

/**
 * Automatikus szakasz-felismerés és átlagsebesség-mérés.
 *
 * Állapotgép: nincs_szakasz → kozeledik → szakaszon → kesz | megszakadt.
 * (Kész/megszakadt után közvetlenül jöhet a következő szakasz is, mert az olasz
 * Tutor-szakaszok gyakran egymás után következnek.)
 */
export class SectionTracker {
  private readonly opts: TrackerOptions;
  private readonly prepared: Prepared[];
  private readonly filter: FixFilter;
  private state: TrackerState = 'nincs_szakasz';
  private current: Prepared | null = null;
  private active: Active | null = null;
  private prevFix: GpsFix | null = null;
  private approachLost = 0;
  private finishedAt = 0;
  private lastResult: SectionResult | null = null;
  private abortReason: AbortReason | null = null;
  private transitions: Transition[] = [];

  constructor(sections: readonly Section[], options: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER_OPTIONS, ...options };
    this.filter = new FixFilter(this.opts.fixFilter);
    this.prepared = sections.map((section) => ({
      section,
      route: new Route(section.geometry?.length ? section.geometry : [section.start, section.end], section.lengthM),
    }));
  }

  get currentState(): TrackerState {
    return this.state;
  }

  update(fix: GpsFix): TrackerSnapshot {
    this.transitions = [];
    if (!this.filter.check(fix).ok) {
      this.checkGap(fix.timestamp);
      return this.snapshot(fix.timestamp);
    }
    const prev = this.prevFix;
    this.prevFix = fix;
    if (this.state === 'szakaszon') {
      this.updateActive(prev, fix);
      if (this.currentState === 'kesz') this.detect(prev, fix);
    } else {
      this.detect(prev, fix);
    }
    return this.snapshot(fix.timestamp);
  }

  /** Fix nélküli frissítés (pl. másodpercenként a kijelzőhöz): becslés és jelkiesés-figyelés. */
  tick(nowMs: number): TrackerSnapshot {
    this.transitions = [];
    this.checkGap(nowMs);
    return this.snapshot(nowMs);
  }

  reset(): void {
    this.transitions = [];
    this.state = 'nincs_szakasz';
    this.current = null;
    this.active = null;
    this.prevFix = null;
    this.filter.reset();
    this.lastResult = null;
    this.abortReason = null;
  }

  snapshot(nowMs: number): TrackerSnapshot {
    return {
      state: this.state,
      section: this.current?.section ?? null,
      live: this.state === 'szakaszon' ? this.liveMetrics(nowMs) : null,
      lastResult: this.lastResult,
      abortReason: this.abortReason,
      transitions: this.transitions,
    };
  }

  // --- felismerés (szakaszon kívül) ---

  private detect(prev: GpsFix | null, fix: GpsFix): void {
    const candidates = this.prepared.filter(
      (p) => haversineM(fix, p.route.start) <= this.opts.approachRadiusM + 1000,
    );

    for (const p of candidates) {
      const entryTime = this.checkEntry(p, prev, fix);
      if (entryTime !== null) {
        this.enter(p, entryTime, fix);
        return;
      }
    }

    let approaching: Prepared | null = null;
    let bestDist = Infinity;
    for (const p of candidates) {
      const d = haversineM(fix, p.route.start);
      if (d < bestDist && this.isApproaching(p, prev, fix)) {
        approaching = p;
        bestDist = d;
      }
    }

    if (approaching) {
      this.approachLost = 0;
      if (this.state !== 'kozeledik' || this.current !== approaching) {
        this.current = approaching;
        this.setState('kozeledik', fix.timestamp);
      }
      return;
    }

    if (this.state === 'kozeledik') {
      if (++this.approachLost >= 3) {
        this.current = null;
        this.setState('nincs_szakasz', fix.timestamp);
      }
    } else if (
      (this.state === 'kesz' || this.state === 'megszakadt') &&
      fix.timestamp - this.finishedAt >= this.opts.resultHoldMs
    ) {
      this.current = null;
      this.setState('nincs_szakasz', fix.timestamp);
    }
  }

  /** Belépés a kapuzónába a helyes irányban; a belépés (interpolált) idejét adja, vagy `null`-t. */
  private checkEntry(p: Prepared, prev: GpsFix | null, fix: GpsFix): number | null {
    const o = this.opts;
    const hint = { fromM: -Infinity, toM: o.gateZoneM + 2000 };
    const proj = p.route.project(fix, hint);
    if (proj.crossM > o.entryCrossM || proj.alongM < 0) return null;

    const prevProj = prev ? p.route.project(prev, hint) : null;
    const crossed = prevProj !== null && prevProj.alongM < 0 && prevProj.crossM <= o.approachCrossM;
    const inZone = proj.alongM <= o.gateZoneM;
    const dtS = prev ? (fix.timestamp - prev.timestamp) / 1000 : 0;
    if (!inZone && !(crossed && proj.alongM <= o.gateZoneM + o.fixFilter.maxPlausibleSpeedMps * dtS)) {
      return null;
    }
    if (!this.directionOk(p, proj, prevProj, prev, fix)) return null;

    if (crossed && prev) {
      const f = -prevProj.alongM / (proj.alongM - prevProj.alongM);
      return prev.timestamp + f * (fix.timestamp - prev.timestamp);
    }
    const v = this.speedOf(prev, fix);
    return v && v > 0 ? fix.timestamp - (proj.alongM / v) * 1000 : fix.timestamp;
  }

  private isApproaching(p: Prepared, prev: GpsFix | null, fix: GpsFix): boolean {
    const o = this.opts;
    if (haversineM(fix, p.route.start) > o.approachRadiusM) return false;
    const hint = { fromM: -Infinity, toM: 0 };
    const proj = p.route.project(fix, hint);
    if (proj.alongM >= 0 || proj.crossM > o.approachCrossM) return false;
    const prevProj = prev ? p.route.project(prev, hint) : null;
    return this.directionOk(p, proj, prevProj, prev, fix);
  }

  private directionOk(
    p: Prepared,
    proj: RouteProjection,
    prevProj: RouteProjection | null,
    prev: GpsFix | null,
    fix: GpsFix,
  ): boolean {
    const heading = this.motionHeading(prev, fix);
    if (heading !== null) {
      return angleDiffDeg(heading, p.route.bearingAt(Math.max(0, proj.alongM))) <= this.opts.maxHeadingDiffDeg;
    }
    // Irányszög nélkül: az útvonal menti haladás iránya dönt.
    return prevProj !== null && proj.alongM - prevProj.alongM >= 3;
  }

  private enter(p: Prepared, entryTime: number, fix: GpsFix): void {
    const along = Math.max(0, p.route.project(fix, { fromM: -Infinity, toM: this.opts.gateZoneM + 2000 }).alongM);
    this.current = p;
    this.abortReason = null;
    this.active = {
      entryTime,
      lastAlongM: along,
      lastAcceptedTime: fix.timestamp,
      lastSpeedMps: validSpeed(fix),
      history: [
        { t: entryTime, along: 0 },
        { t: fix.timestamp, along },
      ],
      offRouteCount: 0,
      offRouteSince: null,
      wrongWayCount: 0,
    };
    this.setState('szakaszon', fix.timestamp);
  }

  // --- mérés a szakaszon ---

  private updateActive(prev: GpsFix | null, fix: GpsFix): void {
    const a = this.active!;
    const p = this.current!;
    const o = this.opts;
    if (fix.timestamp - a.lastAcceptedTime > o.maxGapMs) {
      this.abort('jelvesztes', fix.timestamp);
      return;
    }
    const dtS = (fix.timestamp - a.lastAcceptedTime) / 1000;
    const proj = p.route.project(fix, {
      fromM: a.lastAlongM - 200,
      toM: a.lastAlongM + o.fixFilter.maxPlausibleSpeedMps * dtS + 300,
    });

    if (proj.crossM > o.offRouteCrossM) {
      a.offRouteCount++;
      a.offRouteSince ??= fix.timestamp;
      if (a.offRouteCount >= o.offRouteMinFixes && fix.timestamp - a.offRouteSince >= o.offRouteMinMs) {
        this.abort('letert', fix.timestamp);
      }
      return;
    }
    const heading = this.motionHeading(prev, fix);
    if (heading !== null && angleDiffDeg(heading, proj.bearingDeg) >= o.wrongWayDiffDeg) {
      if (++a.wrongWayCount >= o.wrongWayMinFixes) this.abort('ellenirany', fix.timestamp);
      return;
    }
    a.offRouteCount = 0;
    a.offRouteSince = null;
    a.wrongWayCount = 0;

    const L = p.route.lengthM;
    if (proj.alongM >= L) {
      // Kilépés: a végpont átlépésének idejét az utolsó két pont között interpoláljuk.
      // Jelkiesés után is pontos, mert a megtett utat az útvonalon mérjük.
      const exitTime =
        proj.alongM > a.lastAlongM
          ? a.lastAcceptedTime + ((L - a.lastAlongM) / (proj.alongM - a.lastAlongM)) * (fix.timestamp - a.lastAcceptedTime)
          : fix.timestamp;
      this.finish(exitTime, fix.timestamp);
      return;
    }

    // Kis visszalépést (GPS-zaj) nem veszünk figyelembe: a megtett út nem csökken.
    if (proj.alongM > a.lastAlongM) a.lastAlongM = proj.alongM;
    const derived = dtS > 0 ? (a.lastAlongM - (a.history[a.history.length - 1]?.along ?? 0)) / dtS : null;
    a.lastSpeedMps = validSpeed(fix) ?? derived;
    a.lastAcceptedTime = fix.timestamp;
    a.history.push({ t: fix.timestamp, along: a.lastAlongM });
    while (a.history.length > 2 && fix.timestamp - a.history[0]!.t > 30_000) a.history.shift();
  }

  private liveMetrics(nowMs: number): LiveMetrics {
    const a = this.active!;
    const p = this.current!;
    const L = p.route.lengthM;
    const sinceFix = nowMs - a.lastAcceptedTime;
    const estimated = sinceFix > this.opts.estimateAfterMs;
    const v = a.lastSpeedMps ?? this.historySpeed(a);
    let distanceM = a.lastAlongM;
    if (estimated && v !== null) {
      // Holtszámítás (dead reckoning) a legutóbbi sebességgel – az alagút végén a valódi fix felülírja.
      distanceM = Math.min(L, a.lastAlongM + (v * sinceFix) / 1000);
    }
    const elapsedMs = Math.max(0, nowMs - a.entryTime);
    const required = requiredSpeed({
      lengthM: L,
      speedLimitKmh: p.section.speedLimitKmh,
      distanceDoneM: distanceM,
      elapsedMs,
      minPracticalKmh: this.opts.minPracticalKmh,
    });
    const currentKmh = v !== null ? mpsToKmh(v) : null;
    return {
      distanceM,
      remainingM: Math.max(0, L - distanceM),
      elapsedMs,
      averageKmh: averageSpeedKmh(distanceM, elapsedMs),
      currentKmh,
      required,
      slowDownKmh: slowDownByKmh(currentKmh, required),
      estimated,
    };
  }

  private historySpeed(a: Active): number | null {
    const first = a.history[0];
    const last = a.history[a.history.length - 1];
    if (!first || !last || last.t - first.t < 1000) return null;
    return (last.along - first.along) / ((last.t - first.t) / 1000);
  }

  private finish(exitTime: number, now: number): void {
    const a = this.active!;
    const p = this.current!;
    const averageKmh = mpsToKmh(p.route.lengthM / ((exitTime - a.entryTime) / 1000));
    this.lastResult = {
      sectionId: p.section.id,
      entryTime: a.entryTime,
      exitTime,
      lengthM: p.route.lengthM,
      averageKmh,
      speedLimitKmh: p.section.speedLimitKmh,
      overLimit: averageKmh > p.section.speedLimitKmh,
    };
    this.active = null;
    this.finishedAt = now;
    this.setState('kesz', now);
  }

  private abort(reason: AbortReason, now: number): void {
    this.abortReason = reason;
    this.active = null;
    this.finishedAt = now;
    this.setState('megszakadt', now);
  }

  private checkGap(nowMs: number): void {
    if (this.state === 'szakaszon' && nowMs - this.active!.lastAcceptedTime > this.opts.maxGapMs) {
      this.abort('jelvesztes', nowMs);
    }
  }

  private setState(to: TrackerState, at: number): void {
    if (to === this.state) return;
    this.transitions.push({ from: this.state, to, sectionId: this.current?.section.id ?? null, at });
    this.state = to;
  }

  private motionHeading(prev: GpsFix | null, fix: GpsFix): number | null {
    const speed = validSpeed(fix);
    if (fix.heading !== null && fix.heading >= 0 && (speed === null || speed >= this.opts.minHeadingSpeedMps)) {
      return fix.heading;
    }
    if (prev && haversineM(prev, fix) >= 10) return bearingDeg(prev, fix);
    return null;
  }

  private speedOf(prev: GpsFix | null, fix: GpsFix): number | null {
    const s = validSpeed(fix);
    if (s !== null) return s;
    if (!prev) return null;
    const dt = (fix.timestamp - prev.timestamp) / 1000;
    return dt > 0 ? haversineM(prev, fix) / dt : null;
  }
}

function validSpeed(fix: GpsFix): number | null {
  return fix.speed !== null && fix.speed >= 0 && Number.isFinite(fix.speed) ? fix.speed : null;
}
