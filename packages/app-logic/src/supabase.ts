import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import type { Section } from '@atlagsebesseg/core';
import { rowToSection, type SectionRow } from '@atlagsebesseg/data/rows';
import type { ReportInsert } from './reports';
import type { BBox } from './sectionCache';

export type { SupabaseClient };

export interface SupabaseConfig {
  url?: string | null;
  anonKey?: string | null;
  /** Munkamenet-tár (mobilon AsyncStorage, weben localStorage). */
  storage?: SupportedStorage;
  detectSessionInUrl?: boolean;
}

/** `null`, ha nincs beállítva – akkor az app offline módban, a beépített szakaszokkal fut. */
export function createSupabaseClient(cfg: SupabaseConfig): SupabaseClient | null {
  if (!cfg.url || !cfg.anonKey) return null;
  return createClient(cfg.url, cfg.anonKey, {
    auth: {
      ...(cfg.storage ? { storage: cfg.storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: cfg.detectSessionInUrl ?? false,
    },
  });
}

function need(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('nincs Supabase-beállítás');
  return client;
}

/** Bejelentkezés: meglévő munkamenet, különben anonim. A felhasználó azonosítóját adja. */
/** A meglévő munkamenet felhasználója – bejelentkezést NEM indít (olvasáshoz nem kell). */
export async function currentUserId(client: SupabaseClient | null): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function ensureSignedIn(client: SupabaseClient | null): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: anon, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return anon.user?.id ?? null;
}

/** A téglalap szakaszai (`sections_in_bbox`). */
export async function fetchSectionsInBBox(client: SupabaseClient | null, b: BBox): Promise<Section[]> {
  const { data, error } = await need(client).rpc('sections_in_bbox', {
    p_south: b.south,
    p_west: b.west,
    p_north: b.north,
    p_east: b.east,
  });
  if (error) throw error;
  return (data as SectionRow[]).map(rowToSection);
}

export interface ReportRow {
  id: string;
  type: string;
  lat: number;
  lon: number;
  heading_deg: number | null;
  gate_kind: 'kezdo' | 'zaro' | null;
  confirmations: number;
  denials: number;
  created_at: string;
  expires_at: string;
  user_id: string;
}

/** Le nem járt bejelentések a téglalapban (olvasás bejelentkezés nélkül is megy). */
export async function listActiveReports(client: SupabaseClient | null, b: BBox): Promise<ReportRow[]> {
  const { data, error } = await need(client)
    .from('active_reports')
    .select('id,type,lat,lon,heading_deg,gate_kind,confirmations,denials,created_at,expires_at,user_id')
    .gte('lat', b.south)
    .lte('lat', b.north)
    .gte('lon', b.west)
    .lte('lon', b.east)
    .limit(500);
  if (error) throw error;
  return data as ReportRow[];
}

/** Bejelentés(ek) – anonim bejelentkezéssel. */
export async function createReports(client: SupabaseClient | null, rows: readonly ReportInsert[]): Promise<string[]> {
  await ensureSignedIn(client);
  const { data, error } = await need(client).from('reports').insert(rows).select('id');
  if (error) throw error;
  return (data as { id: string }[]).map((r) => r.id);
}

/** Megerősítés (true) vagy cáfolat (false); újraszavazásnál felülírja a sajátot. */
export async function voteReport(client: SupabaseClient | null, reportId: string, confirm: boolean): Promise<void> {
  await ensureSignedIn(client);
  const { error } = await need(client)
    .from('report_votes')
    .upsert({ report_id: reportId, confirm }, { onConflict: 'report_id,user_id' });
  if (error) throw error;
}
