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
