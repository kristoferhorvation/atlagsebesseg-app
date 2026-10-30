import { angleDiffDeg, bearingDeg, haversineM, type GpsFix } from '@atlagsebesseg/core';
import { CAMERA_ALERT } from './navigation/config';
import type { ActiveReport } from './reportFeed';

/**
 * Bejelentés közeledéskor (AOS14, weben és iOS-en) – EGY kártya, a kamera-figyelmeztetés helyén és stílusában (a manőver-
 * kártya alatt; navigáció nélkül ugyanott önállóan): előbb figyelmeztet („Rendőrség 350 m”, a kamerával azonos
 * `max(CAMERA_ALERT.minM, CAMERA_ALERT.leadS × sebesség)` távolságon belül, előttünk ±`coneDeg`), `nearM`-rel a bejelentés
 * előtt ugyanaz a kártya helyben „Még ott van? Igen / Nem”-re vált (álló autónál irány nélkül is `nearM`-en belül). A kérdés az
 * elhaladás után még `showMs`-ig látható, aztán eltűnik; válaszra azonnal. Arra a bejelentésre nem tér vissza; a sajátra és a
 * megszavazottra soha.
 */
export const REPORT_PROMPT = {
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
 * A kártya állapotgépe (`update` minden fixnél / óra-lépésnél): figyelmeztetés → kérdés (`nearM`-en belül) → elhaladás után
 * `showMs` → vége; válaszra (vagy ha a bejelentés eltűnt, vagy messzire kerültünk) azonnal vége. Kérdés nélküli elhaladás
 * (a bejelentés `nearM`-nél messzebb maradt): rögtön vége. Egy bejelentés egyszer kerül sorra – a munkamenet végéig.
 */
export class ReportPromptWatch {
  private readonly done = new Set<string>();
  private cur: { id: string; asking: boolean; passedAt: number | null; minD: number } | null = null;

  update(fix: GpsFix | null, reports: readonly ActiveReport[], voted: (id: string) => boolean, now: number): ReportPrompt | null {
    const c = this.cur;
    if (c) {
      const r = reports.find((x) => x.id === c.id);
      const g = r && fix ? geometry(fix, r) : null;
      if (g) c.minD = Math.min(c.minD, g.d);
      if (g && !c.asking && g.d <= REPORT_PROMPT.nearM) c.asking = true;
      // a kérdés alatt az elhaladás (mögöttünk van) indítja a `showMs`-t
      if (g && c.asking && c.passedAt === null && g.behind) c.passedAt = now;
      const far = g !== null && g.d > 2 * reportAlertM(fix!.speed);
      const over =
        !r ||
        voted(c.id) ||
        far ||
        (c.asking ? c.passedAt !== null && now - c.passedAt >= REPORT_PROMPT.showMs : g !== null && gone(g, c.minD, reportAlertM(fix!.speed)));
      if (!over) return { id: c.id, phase: c.asking ? 'ask' : 'approach', distanceM: g?.d ?? NaN };
      this.finish();
    }
    if (!fix) return null;
    const r = reportPromptCandidate(fix, reports, (id) => this.done.has(id) || voted(id));
    if (!r) return null;
    const g = geometry(fix, r);
    this.cur = { id: r.id, asking: g.d <= REPORT_PROMPT.nearM, passedAt: null, minD: g.d };
    return { id: r.id, phase: this.cur.asking ? 'ask' : 'approach', distanceM: g.d };
  }

  /** Válasz (Igen / Nem) vagy ×: a kártya azonnal eltűnik, erre a bejelentésre nem tér vissza. */
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
