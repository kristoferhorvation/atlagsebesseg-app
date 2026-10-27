import type { GpsFix } from '@atlagsebesseg/core';
import type { GateReportInsert } from './gateReports';

/** A `public.report_type` enum értékei (supabase/migrations). */
export type ReportType = 'traffipax' | 'rendorseg' | 'baleset' | 'akadaly' | 'utlezaras' | 'szakasz_hiba' | 'ideiglenes_kapu';

/** Egyszerű (nem kapu) bejelentés sora; user_id-t a szerver adja. */
export interface SimpleReportInsert {
  type: Exclude<ReportType, 'ideiglenes_kapu'>;
  lat: number;
  lon: number;
  heading_deg: number | null;
}

export type ReportInsert = SimpleReportInsert | GateReportInsert;

/** Egy ideiglenes kapu a jelenlegi helyről. */
export type GateChoice = 'kapu_kezdo' | 'kapu_zaro';

/**
 * A bejelentés-lap választható elemei. Az `ideiglenes_szakasz` nem egy sor, hanem egy folyamat:
 * elindítja a kézi mérést és bejelenti a kezdő kaput; a mérés „Vége” gombja a záró kaput.
 */
export type ReportChoice = SimpleReportInsert['type'] | 'ideiglenes_szakasz';

export const REPORT_CHOICES: readonly { id: ReportChoice; label: string }[] = [
  { id: 'rendorseg', label: 'Rendőrség' },
  { id: 'traffipax', label: 'Traffipax' },
  { id: 'baleset', label: 'Baleset' },
  { id: 'akadaly', label: 'Akadály' },
  { id: 'utlezaras', label: 'Útlezárás' },
  { id: 'szakasz_hiba', label: 'Hibás szakasz' },
  { id: 'ideiglenes_szakasz', label: 'Ideiglenes szakasz kezdete' },
];

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
