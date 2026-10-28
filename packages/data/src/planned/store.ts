import type { SupabaseRest } from '../supabaseRest';
import type { PlannedStore } from './run';

/** A `planned_checks` tábla írása a service role kulccsal (PostgREST). */
export function restPlannedStore(db: SupabaseRest): PlannedStore {
  const q = encodeURIComponent;
  return {
    upsert: (rows) => db.upsert('planned_checks', rows, 'id'),
    deleteExpired: (nowIso) => db.delete('planned_checks', `valid_to=lt.${q(nowIso)}`),
    deleteStale: (src, ids) =>
      db.delete('planned_checks', `source_url=eq.${q(src)}${ids.length ? `&id=not.in.(${ids.map(q).join(',')})` : ''}`),
    logRun: (ok, summary, error) => db.insert('planned_check_runs', [{ ok, summary, error: error ?? null }]),
  };
}
