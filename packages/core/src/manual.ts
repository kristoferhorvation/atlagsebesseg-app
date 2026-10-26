import { bearingDeg, haversineM } from './geo';
import { DEFAULT_FIX_FILTER, FixFilter, type FixFilterOptions } from './fixFilter';
import { averageSpeedKmh } from './metrics';
import type { GpsFix } from './types';

export interface ManualOptions {
  fixFilter: FixFilterOptions;
  /** Ennél hosszabb kiesés "becsült" (egyenes vonalú) szakasznak számít (ms). */
  gapMs: number;
  /**
   * Ennél kisebb elmozdulást nem adunk hozzá (álló helyzetben a zaj ne növelje az utat).
   * A tényleges küszöb max(minStepM, 2 × pontosság), mert két független fix ennyire térhet el.
   */
  minStepM: number;
}

export const DEFAULT_MANUAL_OPTIONS: ManualOptions = {
  fixFilter: DEFAULT_FIX_FILTER,
  gapMs: 5000,
  minStepM: 5,
};

export interface ManualSnapshot {
  running: boolean;
  /** GPS-útból számolt hossz (m). */
  distanceM: number;
  /** Az első és az utolsó elfogadott fix között eltelt idő (ms). */
  elapsedMs: number;
  averageKmh: number | null;
  /** A kiesések alatt egyenessel becsült úthossz (m). */
  estimatedGapM: number;
  acceptedFixes: number;
}

/** Egy kapu helye és iránya – kézi mérés végén ebből lehet ideiglenes kaput bejelenteni. */
export interface ManualGate {
  lat: number;
  lon: number;
  /** Haladási irány a kapunál (fok), ha meghatározható. */
  headingDeg: number | null;
  timestamp: number;
}

export interface ManualResult extends ManualSnapshot {
  startedAt: number;
  stoppedAt: number;
  /** A mért szakasz első és utolsó elfogadott pontja (kezdő- és zárókapu); `null`, ha nincs elég adat. */
  gates: { start: ManualGate; end: ManualGate } | null;
}

/**
 * Kézi mód: gombnyomásra indul és áll le, a hosszt a GPS-útból számolja.
 *
 * Távolság és idő is az első és az utolsó elfogadott fix között mérődik, így a
 * gombnyomás és az első fix közötti késés nem torzítja az átlagot. Jelkiesésnél
 * a két szélső fix közti egyenes a becslés (kanyarban kissé alábecsül).
 */
export class ManualTracker {
  private readonly opts: ManualOptions;
  private readonly filter: FixFilter;
  private running = false;
  private startedAt = 0;
  private first: GpsFix | null = null;
  private anchor: GpsFix | null = null;
  private lastTime = 0;
  private distanceM = 0;
  private estimatedGapM = 0;
  private accepted = 0;
  private startHeading: number | null = null;
  private last: GpsFix | null = null;
  private lastMoveHeading: number | null = null;

  constructor(options: Partial<ManualOptions> = {}) {
    this.opts = { ...DEFAULT_MANUAL_OPTIONS, ...options };
    this.filter = new FixFilter(this.opts.fixFilter);
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(nowMs: number): void {
    this.running = true;
    this.startedAt = nowMs;
    this.first = null;
    this.anchor = null;
    this.lastTime = 0;
    this.distanceM = 0;
    this.estimatedGapM = 0;
    this.accepted = 0;
    this.startHeading = null;
    this.last = null;
    this.lastMoveHeading = null;
    this.filter.reset();
  }

  addFix(fix: GpsFix): ManualSnapshot {
    if (this.running && fix.timestamp >= this.startedAt && this.filter.check(fix).ok) {
      this.accepted++;
      if (!this.first || !this.anchor) {
        this.first = fix;
        this.anchor = fix;
      } else {
        const step = haversineM(this.anchor, fix);
        const gap = fix.timestamp - this.lastTime > this.opts.gapMs;
        if (step >= Math.max(this.opts.minStepM, 2 * (fix.accuracy ?? 0)) || gap) {
          this.distanceM += step;
          if (gap) this.estimatedGapM += step;
          this.lastMoveHeading = bearingDeg(this.anchor, fix);
          this.startHeading ??= this.first.heading ?? this.lastMoveHeading;
          this.anchor = fix;
        }
      }
      this.last = fix;
      this.lastTime = fix.timestamp;
    }
    return this.snapshot();
  }

  stop(nowMs: number): ManualResult {
    const snap = this.snapshot();
    this.running = false;
    const first = this.first;
    const last = this.last;
    const gates =
      first && last && first !== last && this.distanceM > 0
        ? {
            start: gate(first, this.startHeading),
            end: gate(last, last.heading ?? this.lastMoveHeading),
          }
        : null;
    return { ...snap, running: false, startedAt: this.startedAt, stoppedAt: nowMs, gates };
  }

  snapshot(): ManualSnapshot {
    const elapsedMs = this.first ? this.lastTime - this.first.timestamp : 0;
    return {
      running: this.running,
      distanceM: this.distanceM,
      elapsedMs,
      averageKmh: averageSpeedKmh(this.distanceM, elapsedMs),
      estimatedGapM: this.estimatedGapM,
      acceptedFixes: this.accepted,
    };
  }
}

function gate(fix: GpsFix, headingDeg: number | null): ManualGate {
  return { lat: fix.lat, lon: fix.lon, headingDeg, timestamp: fix.timestamp };
}
