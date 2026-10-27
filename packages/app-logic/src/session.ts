import {
  haversineM,
  ManualTracker,
  SectionTracker,
  type AbortReason,
  type GpsFix,
  type LiveMetrics,
  type ManualResult,
  type ManualSnapshot,
  type Section,
  type SectionResult,
  type TrackerOptions,
  type TrackerSnapshot,
} from '@atlagsebesseg/core';
import { progressOf, speedStatus, type SpeedStatus } from './display';

/** A kijelző állapotai (DESIGN.md): a core állapotgépe + kézi mód + háttérbe kerülés. */
export type SessionPhase = 'nincs_szakasz' | 'kozeledik' | 'meres' | 'befejezve' | 'kezi' | 'kezi_eredmeny' | 'megszakadt';

/** Miért szakadt meg a mérés: a core okai, vagy az app háttérbe került (nincs GPS a háttérben). */
export type InterruptReason = AbortReason | 'hatter';

export interface SessionView {
  phase: SessionPhase;
  /** Közeledéskor, mérés közben, befejezve / megszakadva az érintett szakasz. */
  section: Section | null;
  live: LiveMetrics | null;
  /** Az átlag színkódja (csak mérés közben és befejezve). */
  status: SpeedStatus | null;
  /** Megtett hányad 0…1 (mérés közben). */
  progress: number | null;
  /** Közeledéskor a belépő kapu légvonalbeli távolsága (m). */
  approachM: number | null;
  result: SectionResult | null;
  interruption: { reason: InterruptReason; at: number } | null;
  manual: ManualSnapshot | null;
  manualResult: ManualResult | null;
  lastFix: GpsFix | null;
  /** Pillanatnyi sebesség km/h-ban (szakaszon a core-ból, egyébként a GPS-ből). */
  currentKmh: number | null;
}

export interface SessionOptions {
  /** Óra (ms) – a szimulátor a lejátszás idejét adja. */
  now?: () => number;
  tracker?: Partial<TrackerOptions>;
  /** Az eredmények / megszakítás ennyi ideig látszanak (ms). */
  holdMs?: number;
}

/**
 * A mérés egy példánya a kijelző számára: a `SectionTracker` (automatikus) és a `ManualTracker`
 * (kézi) együtt, plusz a háttérbe kerülés tiszta kezelése – ilyenkor a mérés megszakad (nem
 * becsül tovább, nincs hibás átlag), és a következő belépő kapuig nem indul újra.
 */
export class TrackingSession {
  private readonly tracker: SectionTracker;
  private readonly manualTracker = new ManualTracker();
  private readonly now: () => number;
  private readonly holdMs: number;
  private snap: TrackerSnapshot;
  private manual: ManualSnapshot | null = null;
  private manualResult: { result: ManualResult; at: number } | null = null;
  private interruption: { reason: InterruptReason; at: number; section: Section | null } | null = null;
  private dismissed: SectionResult | number | null = null;
  /** A core utolsó megszakításának ideje (a snapshot átmenetei csak egy hívásig élnek). */
  private coreAbortAt: number | null = null;
  private lastFix: GpsFix | null = null;

  constructor(sections: readonly Section[], opts: SessionOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.holdMs = opts.holdMs ?? 60_000;
    this.tracker = new SectionTracker(sections, opts.tracker);
    this.snap = this.tracker.snapshot(this.now());
  }

  /** Új szakaszlista (pl. a szerverről) – a futó mérés megmarad. */
  setSections(sections: readonly Section[]): void {
    this.tracker.setSections(sections);
  }

  onFix(fix: GpsFix): SessionView {
    this.lastFix = fix;
    this.absorb(this.tracker.update(fix));
    if (this.snap.state === 'szakaszon' || this.snap.state === 'kozeledik') this.dismissed = null;
    if (this.manual) this.manual = this.manualTracker.addFix(fix);
    return this.view();
  }

  /** Fix nélküli frissítés (másodpercenként): becslés, jelkiesés, lejáratok. */
  tick(): SessionView {
    this.absorb(this.tracker.tick(this.now()));
    return this.view();
  }

  private absorb(snap: TrackerSnapshot): void {
    this.snap = snap;
    const t = snap.transitions.find((x) => x.to === 'megszakadt');
    if (t) this.coreAbortAt = t.at;
  }

  /** Az app háttérbe került: a futó mérés megszakad (a szakaszon és kézi módban is). */
  interrupt(reason: InterruptReason = 'hatter'): SessionView {
    const at = this.now();
    const wasMeasuring = this.snap.state === 'szakaszon';
    const section = this.snap.section;
    if (this.snap.state === 'szakaszon' || this.snap.state === 'kozeledik') {
      this.tracker.reset();
      this.snap = this.tracker.snapshot(at);
    }
    if (this.manual) {
      this.manualTracker.stop(at);
      this.manual = null;
      this.interruption = { reason, at, section: null };
    }
    if (wasMeasuring) this.interruption = { reason, at, section };
    this.lastFix = null;
    return this.view();
  }

  startManual(): SessionView {
    this.manualTracker.start(this.now());
    this.manual = this.manualTracker.snapshot();
    this.manualResult = null;
    this.interruption = null;
    return this.view();
  }

  stopManual(): SessionView {
    if (this.manual) {
      const at = this.now();
      this.manualResult = { result: this.manualTracker.stop(at), at };
      this.manual = null;
    }
    return this.view();
  }

  /** Az összegzés / megszakítás-kártya bezárása. */
  dismiss(): SessionView {
    this.manualResult = null;
    this.interruption = null;
    if (this.snap.state === 'kesz') this.dismissed = this.snap.lastResult;
    if (this.snap.state === 'megszakadt') this.dismissed = this.coreAbortAt;
    return this.view();
  }

  view(): SessionView {
    const now = this.now();
    if (this.interruption && now - this.interruption.at > this.holdMs) this.interruption = null;
    if (this.manualResult && now - this.manualResult.at > this.holdMs) this.manualResult = null;

    const s = this.snap;
    const fixKmh = this.lastFix?.speed != null ? this.lastFix.speed * 3.6 : null;
    const base: SessionView = {
      phase: 'nincs_szakasz',
      section: null,
      live: null,
      status: null,
      progress: null,
      approachM: null,
      result: null,
      interruption: null,
      manual: this.manual,
      manualResult: this.manualResult?.result ?? null,
      lastFix: this.lastFix,
      currentKmh: s.live?.currentKmh ?? fixKmh,
    };

    if (this.manual) return { ...base, phase: 'kezi' };
    if (s.state === 'szakaszon' && s.section && s.live) {
      return {
        ...base,
        phase: 'meres',
        section: s.section,
        live: s.live,
        status: speedStatus(s.live.averageKmh, s.section.speedLimitKmh),
        progress: progressOf(s.live.distanceM, s.section.lengthM),
      };
    }
    if (this.interruption) {
      const { reason, at, section } = this.interruption;
      return { ...base, phase: 'megszakadt', section, interruption: { reason, at } };
    }
    if (s.state === 'megszakadt' && s.abortReason && this.dismissed !== this.coreAbortAt) {
      const at = this.coreAbortAt ?? now;
      return { ...base, phase: 'megszakadt', section: s.section, interruption: { reason: s.abortReason, at } };
    }
    if (s.state === 'kesz' && s.lastResult && this.dismissed !== s.lastResult) {
      return {
        ...base,
        phase: 'befejezve',
        section: s.section,
        result: s.lastResult,
        status: speedStatus(s.lastResult.averageKmh, s.lastResult.speedLimitKmh),
      };
    }
    if (s.state === 'kozeledik' && s.section) {
      return {
        ...base,
        phase: 'kozeledik',
        section: s.section,
        approachM: this.lastFix ? haversineM(this.lastFix, s.section.start) : null,
      };
    }
    if (this.manualResult) return { ...base, phase: 'kezi_eredmeny' };
    return base;
  }
}
