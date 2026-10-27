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

/** Kézi mérés eredményéből a két kapu bejelentése; `null`, ha nincs hely vagy irány. */
export function gateReportsFromManual(
  result: ManualResult,
  extra: { road?: string | null; speedLimitKmh?: number | null } = {},
): [GateReportInsert, GateReportInsert] | null {
  const g = result.gates;
  if (!g || g.start.headingDeg === null || g.end.headingDeg === null) return null;
  const make = (kind: 'kezdo' | 'zaro', gate: typeof g.start): GateReportInsert => ({
    type: 'ideiglenes_kapu',
    gate_kind: kind,
    lat: gate.lat,
    lon: gate.lon,
    heading_deg: Math.round(gate.headingDeg!) % 360,
    road: extra.road?.trim() || null,
    speed_limit_kmh: extra.speedLimitKmh ?? null,
  });
  return [make('kezdo', g.start), make('zaro', g.end)];
}
