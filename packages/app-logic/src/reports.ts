import type { GpsFix } from '@atlagsebesseg/core';
import { t, type TKey } from './i18n';
import type { GateReportInsert } from './gateReports';

/** A `public.report_type` enum értékei (supabase/migrations). */
/** AW18: `dugo` (lassan halad) és `beallt` (áll) – a navigáció „Dugóba kerültél?” kártyája is `dugo`-t küld. */
export type ReportType = 'traffipax' | 'rendorseg' | 'baleset' | 'akadaly' | 'utlezaras' | 'szakasz_hiba' | 'dugo' | 'beallt' | 'ideiglenes_kapu';

/** Egyszerű (nem kapu) bejelentés sora; user_id-t a szerver adja. */
export interface SimpleReportInsert {
  type: Exclude<ReportType, 'ideiglenes_kapu'>;
  lat: number;
  lon: number;
  heading_deg: number | null;
}

export type ReportInsert = SimpleReportInsert | GateReportInsert;

/** Egy ideiglenes kapu a jelenlegi helyről (az „Átlagmérés eleje / vége” bejelentés-típus). */
export type GateChoice = 'kapu_kezdo' | 'kapu_zaro';

/**
 * A bejelentés-lap választható elemei. AW16: az „Átlagmérés eleje / vége” (`kapu_kezdo` / `kapu_zaro`) egy-egy ideiglenes
 * kapu a jelenlegi helyről – ismeretlen mérési zóna bejelentése; a kézi mérés ettől független, privát.
 */
export type ReportChoice = SimpleReportInsert['type'] | GateChoice;

export const REPORT_CHOICES: readonly { id: ReportChoice }[] = [
  { id: 'rendorseg' },
  { id: 'traffipax' },
  { id: 'baleset' },
  { id: 'akadaly' },
  { id: 'utlezaras' },
  { id: 'szakasz_hiba' },
  { id: 'dugo' },
  { id: 'beallt' },
  { id: 'kapu_kezdo' },
  { id: 'kapu_zaro' },
];

/**
 * A bejelentés-lap tételei (AOS14 javítás): az „Átlagmérés eleje” és „vége” EGY tétel – az elküldött „eleje” után ugyanaz a
 * sor „Átlagmérés vége”, amíg el nem küldik, vagy a mérés / navigáció véget nem ér (`gateStartedAfter`); utána visszaáll.
 * AW18: az utolsó sorban a „Dugó” és a „Beállt” a kapu-tétel mellett (a menü magassága nem nő), lásd {@link isRowTile}.
 */
export function reportMenu(gateStarted: boolean): ReportChoice[] {
  return [...REPORT_CHOICES.map((c) => c.id).filter((id) => id !== 'kapu_kezdo' && id !== 'kapu_zaro'), gateStarted ? 'kapu_zaro' : 'kapu_kezdo'];
}

/** Az „eleje elküldve” állapot: sikeres „eleje” → be, sikeres „vége” → ki, a mérés vagy a navigáció vége → ki. */
export function gateStartedAfter(started: boolean, event: { sent: ReportChoice } | 'activityEnded'): boolean {
  if (event === 'activityEnded') return false;
  if (event.sent === 'kapu_kezdo') return true;
  if (event.sent === 'kapu_zaro') return false;
  return started;
}

/** A bejelentés-típus felirata az aktuális nyelven. */
export const reportChoiceLabel = (id: ReportChoice): string => t(`report.type.${id}` as TKey);

const heading = (h: number | null) => (h === null ? null : ((Math.round(h) % 360) + 360) % 360);

/**
 * Egy koppintásos bejelentés a jelenlegi helyről. Kapunál irány kell (a kapu iránya a haladási
 * irány) – ha nincs, `null`.
 */
export function reportFromFix(choice: SimpleReportInsert['type'] | GateChoice, fix: GpsFix): ReportInsert | null {
  if (choice === 'kapu_kezdo' || choice === 'kapu_zaro') {
    const h = heading(fix.heading);
    if (h === null) return null;
    return {
      type: 'ideiglenes_kapu',
      gate_kind: choice === 'kapu_kezdo' ? 'kezdo' : 'zaro',
      lat: fix.lat,
      lon: fix.lon,
      heading_deg: h,
      road: null,
      speed_limit_kmh: null,
    };
  }
  return { type: choice, lat: fix.lat, lon: fix.lon, heading_deg: heading(fix.heading) };
}

/** AW18: a menü utolsó sorának kis csempéi (egy sorban, a kapu-tétel mellett). */
export const isRowTile = (c: ReportChoice): boolean => c === 'dugo' || c === 'beallt';

/** AW18: a dugó-típusok (a közösségi dugó-mintát is küldik). */
export const isJamReport = (c: ReportChoice | ReportType): boolean => c === 'dugo' || c === 'beallt';
