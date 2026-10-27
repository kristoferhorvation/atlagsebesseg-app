import type { ManualResult } from '@atlagsebesseg/core';

/** A `reports` táblába írandó ideiglenes-kapu bejelentés (user_id-t a szerver adja). */
export interface GateReportInsert {
  type: 'ideiglenes_kapu';
  gate_kind: 'kezdo' | 'zaro';
  lat: number;
  lon: number;
  heading_deg: number;
  road: string | null;
  speed_limit_kmh: number | null;
}

type Gate = NonNullable<ManualResult['gates']>['start'];
type Extra = { road?: string | null; speedLimitKmh?: number | null };

function gateRow(kind: 'kezdo' | 'zaro', gate: Gate, extra: Extra): GateReportInsert | null {
  if (gate.headingDeg === null) return null;
  return {
    type: 'ideiglenes_kapu',
    gate_kind: kind,
    lat: gate.lat,
    lon: gate.lon,
    heading_deg: Math.round(gate.headingDeg) % 360,
    road: extra.road?.trim() || null,
    speed_limit_kmh: extra.speedLimitKmh ?? null,
  };
}

/** Kézi mérés eredményéből a két kapu bejelentése; `null`, ha nincs hely vagy irány. */
export function gateReportsFromManual(result: ManualResult, extra: Extra = {}): [GateReportInsert, GateReportInsert] | null {
  const g = result.gates;
  const start = g && gateRow('kezdo', g.start, extra);
  const end = g && gateRow('zaro', g.end, extra);
  return start && end ? [start, end] : null;
}

/**
 * Az ideiglenes szakasz végén küldendő kapuk: mindig a záró, és a kezdő is, ha induláskor nem
 * ment el (pl. álló helyzetben még nem volt irány). A helyek és irányok a kézi mérés első és
 * utolsó elfogadott pontjából jönnek. `null`, ha a mérésből nem határozhatók meg.
 */
export function tempSectionEndReports(result: ManualResult, startSent: boolean): GateReportInsert[] | null {
  if (!startSent) return gateReportsFromManual(result);
  const end = result.gates && gateRow('zaro', result.gates.end, {});
  return end ? [end] : null;
}
