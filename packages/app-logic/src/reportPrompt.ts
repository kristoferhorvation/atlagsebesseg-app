import { angleDiffDeg, bearingDeg, haversineM, type GpsFix } from '@atlagsebesseg/core';
import type { ActiveReport } from './reportFeed';

/**
 * „Még ott van?” (AOS14, weben és iOS-en): közeledéskor a bejelentés kártyája magától megjelenik igen / nem gombbal
 * (`report_votes`). Előttünk (a haladási iránytól legfeljebb `coneDeg`-re) `askM`-en belül, irány nélkül (álló autó)
 * csak `nearM`-en belül kérdez; bejelentésenként egyszer, a saját bejelentésre és a már megszavazottra soha. Válasz
 * nélkül `showMs` után eltűnik.
 */
export const REPORT_PROMPT = {
  askM: 200,
  nearM: 50,
  coneDeg: 45,
  showMs: 10_000,
} as const;

/** A legközelebbi bejelentés, amelyre most rá kell kérdezni (`skip`: már kérdeztük / szavaztunk rá). */
export function reportPromptCandidate(fix: GpsFix, reports: readonly ActiveReport[], skip: (id: string) => boolean): ActiveReport | null {
  let best: ActiveReport | null = null;
  let bestM = Infinity;
  for (const r of reports) {
    if (r.own || skip(r.id)) continue;
    const d = haversineM(fix, r);
    const ahead = fix.heading !== null && angleDiffDeg(fix.heading, bearingDeg(fix, r)) <= REPORT_PROMPT.coneDeg;
    if (!(d <= REPORT_PROMPT.nearM || (ahead && d <= REPORT_PROMPT.askM))) continue;
    if (d < bestM) {
      best = r;
      bestM = d;
    }
  }
  return best;
}

/**
 * A kérdés állapota: melyik bejelentésre kérdezünk most (`update` minden fixnél / óra-lépésnél), és melyikre kérdeztünk
 * már (egyszer kérdez – a munkamenet végéig). A kártya bezárul, ha szavaztunk, lejárt az ideje, vagy a bejelentés eltűnt.
 */
export class ReportPromptWatch {
  private readonly asked = new Set<string>();
  private shown: { id: string; at: number } | null = null;

  /** A most kérdezett bejelentés azonosítója (vagy `null`). */
  update(fix: GpsFix | null, reports: readonly ActiveReport[], voted: (id: string) => boolean, now: number): string | null {
    const s = this.shown;
    if (s) {
      if (now - s.at < REPORT_PROMPT.showMs && !voted(s.id) && reports.some((r) => r.id === s.id)) return s.id;
      this.shown = null;
    }
    if (!fix) return null;
    const c = reportPromptCandidate(fix, reports, (id) => this.asked.has(id) || voted(id));
    if (!c) return null;
    this.asked.add(c.id);
    this.shown = { id: c.id, at: now };
    return c.id;
  }

  /** A kártya bezárása (szavazat vagy ×); erre a bejelentésre többet nem kérdez. */
  close(): void {
    this.shown = null;
  }

  get current(): string | null {
    return this.shown?.id ?? null;
  }
}
