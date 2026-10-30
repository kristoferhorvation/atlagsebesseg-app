import { angleDiffDeg, bearingDeg, haversineM, type GpsFix } from '@atlagsebesseg/core';
import { CAMERA_ALERT } from './navigation/config';
import type { ActiveReport } from './reportFeed';

/**
 * Bejelentés közeledéskor (AOS14, weben és iOS-en) – EGY kártya, a kamera-figyelmeztetés helyén és stílusában (a manőver-
 * kártya alatt; navigáció nélkül ugyanott önállóan): előbb figyelmeztet („Rendőrség 350 m”, a kamerával azonos
 * `max(CAMERA_ALERT.minM, CAMERA_ALERT.leadS × sebesség)` távolságon belül, előttünk ±`coneDeg`), `askM`-en belül ugyanaz a
 * kártya helyben „Még ott van? Igen / Nem”-re vált. Válasz, elhaladás vagy a kérdés után `showMs` múlva eltűnik, és arra a
 * bejelentésre nem tér vissza. Irány nélkül (álló autó) csak `nearM`-en belül, rögtön kérdez. A sajátra és a megszavazottra
 * soha.
 */
export const REPORT_PROMPT = {
  askM: 200,
  nearM: 50,
  coneDeg: 45,
  showMs: 10_000,
} as const;

export type ReportPromptPhase = 'approach' | 'ask';

/** A kártya állapota: melyik bejelentés, figyelmeztet vagy kérdez, és milyen messze van. */
export interface ReportPrompt {
  id: string;
  phase: ReportPromptPhase;
  distanceM: number;
}

/** A figyelmeztetés távolsága a sebességből (m/s), mint a közeli kameránál. */
export const reportAlertM = (speedMps: number | null): number => Math.max(CAMERA_ALERT.minM, CAMERA_ALERT.leadS * Math.max(0, speedMps ?? 0));

function geometry(fix: GpsFix, r: ActiveReport): { d: number; ahead: boolean; behind: boolean } {
  const d = haversineM(fix, r);
  const diff = fix.heading === null ? null : angleDiffDeg(fix.heading, bearingDeg(fix, r));
  return { d, ahead: diff !== null && diff <= REPORT_PROMPT.coneDeg, behind: diff !== null && diff > 90 };
}

/** Ennyire meg kellett közelíteni, hogy a „mögöttünk van” elhaladásnak számítson (hajtűkanyarban a légvonal megtéveszt). */
export const REPORT_PASSED_NEAR_M = 100;

/**
 * Elhaladtunk mellette (már a közelében voltunk, és most mögöttünk van), vagy messzire kerültünk (letértünk). Kanyarban a
 * bejelentés kicsúszhat a ±`coneDeg` kúpból, hajtűkanyarban átmenetileg mögénk is kerülhet – az még nem elhaladás.
 */
const gone = (g: { d: number; behind: boolean }, minD: number, alertM: number) =>
  (g.behind && minD <= REPORT_PASSED_NEAR_M && g.d > REPORT_PROMPT.nearM) || g.d > 2 * alertM;

const asks = (d: number, ahead: boolean) => d <= REPORT_PROMPT.nearM || (ahead && d <= REPORT_PROMPT.askM);

/** A legközelebbi bejelentés, amelyre most figyelmeztetni kell (`skip`: már volt / szavaztunk rá). */
export function reportPromptCandidate(fix: GpsFix, reports: readonly ActiveReport[], skip: (id: string) => boolean): ActiveReport | null {
  const alertM = reportAlertM(fix.speed);
  let best: ActiveReport | null = null;
  let bestM = Infinity;
  for (const r of reports) {
    if (r.own || skip(r.id)) continue;
    const { d, ahead } = geometry(fix, r);
    if (!(d <= REPORT_PROMPT.nearM || (ahead && d <= alertM))) continue;
    if (d < bestM) {
      best = r;
      bestM = d;
    }
  }
  return best;
}

/**
 * A kártya állapotgépe (`update` minden fixnél / óra-lépésnél): figyelmeztetés → kérdés (`askM`) → vége (válasz, elhaladás,
 * a kérdés után `showMs`, vagy a bejelentés eltűnt). Egy bejelentés egyszer kerül sorra – a munkamenet végéig.
 */
export class ReportPromptWatch {
  private readonly done = new Set<string>();
  private cur: { id: string; askAt: number | null; minD: number } | null = null;

  update(fix: GpsFix | null, reports: readonly ActiveReport[], voted: (id: string) => boolean, now: number): ReportPrompt | null {
    const c = this.cur;
    if (c) {
      const r = reports.find((x) => x.id === c.id);
      const g = r && fix ? geometry(fix, r) : null;
      if (g) c.minD = Math.min(c.minD, g.d);
      const over = !r || voted(c.id) || (c.askAt !== null && now - c.askAt >= REPORT_PROMPT.showMs) || (g !== null && gone(g, c.minD, reportAlertM(fix!.speed)));
      if (!over) {
        if (!g) return { id: c.id, phase: c.askAt === null ? 'approach' : 'ask', distanceM: NaN };
        if (c.askAt === null && asks(g.d, g.ahead)) c.askAt = now;
        return { id: c.id, phase: c.askAt === null ? 'approach' : 'ask', distanceM: g.d };
      }
      this.finish();
    }
    if (!fix) return null;
    const r = reportPromptCandidate(fix, reports, (id) => this.done.has(id) || voted(id));
    if (!r) return null;
    const g = geometry(fix, r);
    this.cur = { id: r.id, askAt: asks(g.d, g.ahead) ? now : null, minD: g.d };
    return { id: r.id, phase: this.cur.askAt === null ? 'approach' : 'ask', distanceM: g.d };
  }

  /** Válasz (Igen / Nem) vagy ×: a kártya eltűnik, erre a bejelentésre nem tér vissza. */
  close(): void {
    this.finish();
  }

  get current(): string | null {
    return this.cur?.id ?? null;
  }

  private finish(): void {
    if (this.cur) this.done.add(this.cur.id);
    this.cur = null;
  }
}
