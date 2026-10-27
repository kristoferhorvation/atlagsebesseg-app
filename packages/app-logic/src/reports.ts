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

/** A bejelentés-lap választható elemei, megjelenítési sorrendben. */
export type ReportChoice = SimpleReportInsert['type'] | 'kapu_kezdo' | 'kapu_zaro';

export const REPORT_CHOICES: readonly { id: ReportChoice; label: string; needsHeading: boolean }[] = [
  { id: 'rendorseg', label: 'Rendőrség', needsHeading: false },
  { id: 'traffipax', label: 'Traffipax', needsHeading: false },
  { id: 'baleset', label: 'Baleset', needsHeading: false },
  { id: 'akadaly', label: 'Akadály', needsHeading: false },
  { id: 'utlezaras', label: 'Útlezárás', needsHeading: false },
  { id: 'szakasz_hiba', label: 'Hibás szakasz', needsHeading: false },
  { id: 'kapu_kezdo', label: 'Ideiglenes kapu · kezdő', needsHeading: true },
  { id: 'kapu_zaro', label: 'Ideiglenes kapu · záró', needsHeading: true },
];

const heading = (h: number | null) => (h === null ? null : ((Math.round(h) % 360) + 360) % 360);

/**
 * Egy koppintásos bejelentés a jelenlegi helyről. Kapunál irány kell (a kapu iránya a haladási
 * irány) – ha nincs, `null`.
 */
export function reportFromFix(choice: ReportChoice, fix: GpsFix): ReportInsert | null {
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
