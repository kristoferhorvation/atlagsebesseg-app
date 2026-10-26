import type { GateReportInsert } from '../logic/gateReports';
import type { BBox } from '../logic/sectionCache';
import { ensureSignedIn, supabase } from './supabase';

export interface ReportRow {
  id: string;
  type: string;
  lat: number;
  lon: number;
  heading_deg: number | null;
  gate_kind: 'kezdo' | 'zaro' | null;
  confirmations: number;
  denials: number;
  expires_at: string;
  user_id: string;
}

function client() {
  if (!supabase) throw new Error('nincs Supabase-beállítás');
  return supabase;
}

/** Le nem járt bejelentések a téglalapban (olvasás bejelentkezés nélkül is megy). */
export async function listActiveReports(b: BBox): Promise<ReportRow[]> {
  const { data, error } = await client()
    .from('active_reports')
    .select('id,type,lat,lon,heading_deg,gate_kind,confirmations,denials,expires_at,user_id')
    .gte('lat', b.south)
    .lte('lat', b.north)
    .gte('lon', b.west)
    .lte('lon', b.east)
    .limit(500);
  if (error) throw error;
  return data as ReportRow[];
}

/** Ideiglenes kapu(k) bejelentése – anonim bejelentkezéssel. */
export async function createReports(rows: GateReportInsert[]): Promise<string[]> {
  await ensureSignedIn();
  const { data, error } = await client().from('reports').insert(rows).select('id');
  if (error) throw error;
  return (data as { id: string }[]).map((r) => r.id);
}

/** Megerősítés (true) vagy cáfolat (false); újraszavazásnál felülírja a sajátot. */
export async function voteReport(reportId: string, confirm: boolean): Promise<void> {
  await ensureSignedIn();
  const { error } = await client()
    .from('report_votes')
    .upsert({ report_id: reportId, confirm }, { onConflict: 'report_id,user_id' });
  if (error) throw error;
}
