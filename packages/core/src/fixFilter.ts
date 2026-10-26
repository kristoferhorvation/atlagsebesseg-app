import { haversineM } from './geo';
import type { GpsFix } from './types';

export interface FixFilterOptions {
  /** Ennél pontatlanabb fixet eldobunk (méter). */
  maxAccuracyM: number;
  /** Ennél nagyobb, két fix közötti látszólagos sebesség GPS-ugrásnak számít (m/s). */
  maxPlausibleSpeedMps: number;
  /** Ennyi egymást követő, egymással konzisztens "ugrás" után az új helyzetet fogadjuk el. */
  rebaseAfterJumps: number;
}

export const DEFAULT_FIX_FILTER: FixFilterOptions = {
  maxAccuracyM: 35,
  maxPlausibleSpeedMps: 250 / 3.6,
  rebaseAfterJumps: 3,
};

export type FixRejection = 'pontatlan' | 'idorend' | 'ugras' | 'ervenytelen';

export type FixVerdict = { ok: true } | { ok: false; reason: FixRejection };

/**
 * Kiszűri a pontatlan, időrendben hibás és fizikailag lehetetlen (ugró) fixeket.
 * Ha az utolsó elfogadott fix volt hibás, néhány konzisztens új fix után átáll az új helyzetre.
 */
export class FixFilter {
  private last: GpsFix | null = null;
  private jumpStreak: GpsFix[] = [];

  constructor(private readonly opts: FixFilterOptions = DEFAULT_FIX_FILTER) {}

  get lastAccepted(): GpsFix | null {
    return this.last;
  }

  reset(): void {
    this.last = null;
    this.jumpStreak = [];
  }

  check(fix: GpsFix): FixVerdict {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.timestamp)) {
      return { ok: false, reason: 'ervenytelen' };
    }
    if (fix.accuracy !== null && (fix.accuracy < 0 || fix.accuracy > this.opts.maxAccuracyM)) {
      return { ok: false, reason: 'pontatlan' };
    }
    const last = this.last;
    if (last && fix.timestamp <= last.timestamp) return { ok: false, reason: 'idorend' };
    if (last && impliedSpeed(last, fix) > this.opts.maxPlausibleSpeedMps) {
      const prevJump = this.jumpStreak[this.jumpStreak.length - 1];
      if (prevJump && impliedSpeed(prevJump, fix) > this.opts.maxPlausibleSpeedMps) this.jumpStreak = [];
      this.jumpStreak.push(fix);
      if (this.jumpStreak.length >= this.opts.rebaseAfterJumps) {
        this.accept(fix);
        return { ok: true };
      }
      return { ok: false, reason: 'ugras' };
    }
    this.accept(fix);
    return { ok: true };
  }

  private accept(fix: GpsFix): void {
    this.last = fix;
    this.jumpStreak = [];
  }
}

/** Két fix közötti látszólagos sebesség (m/s), a pontossági sugarakkal csökkentett távolságból. */
export function impliedSpeed(a: GpsFix, b: GpsFix): number {
  const dt = (b.timestamp - a.timestamp) / 1000;
  if (dt <= 0) return Infinity;
  const slack = (a.accuracy ?? 0) + (b.accuracy ?? 0);
  return Math.max(0, haversineM(a, b) - slack) / dt;
}
