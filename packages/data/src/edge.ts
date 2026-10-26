/**
 * Belépési pont az edge function bundle-hez (supabase/functions/promote-temp-gates).
 * Csak fetch-et használ, így Deno-ban (Supabase Edge Runtime) is fut.
 */
import type { LatLon } from '@atlagsebesseg/core';
import { countryAtQuery, DEFAULT_ENDPOINT, roadsQuery, runOverpass, type BBox, type OsmWay } from './overpass';
import { promoteTempGates, type GateReport, type PromoteDeps, type ReadyPair } from './promote';
import { SupabaseRest } from './supabaseRest';

export interface EdgeEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  overpassEndpoint?: string;
}

export function edgeDeps(env: EdgeEnv): PromoteDeps {
  const db = new SupabaseRest({ url: env.supabaseUrl, key: env.serviceRoleKey });
  const endpoint = env.overpassEndpoint ?? DEFAULT_ENDPOINT;
  return {
    readyPairs: () => db.rpc<ReadyPair[]>('temp_gate_ready_pairs'),
    reports: (ids) =>
      db.select<GateReport>('reports', `select=id,lat,lon,heading_deg,gate_kind,road,speed_limit_kmh&id=in.(${ids.join(',')})`),
    roadsIn: async (bbox: BBox) =>
      (await runOverpass(roadsQuery(bbox), { endpoint, retries: 2 })).elements.filter((e): e is OsmWay => e.type === 'way'),
    countryAt: async (p: LatLon) => {
      const res = await runOverpass(countryAtQuery(p.lat, p.lon), { endpoint, retries: 1 });
      const area = res.elements.find((e) => e.tags?.['ISO3166-1']);
      return area?.tags?.['ISO3166-1'] ?? null;
    },
    createSection: (args) => db.rpc<string>('temp_gate_create_section', { ...args }),
    markFailed: (start, end, error) => db.rpc('temp_gate_mark_failed', { p_start: start, p_end: end, p_error: error }),
  };
}

export async function runPromotion(env: EdgeEnv) {
  return promoteTempGates(edgeDeps(env));
}
