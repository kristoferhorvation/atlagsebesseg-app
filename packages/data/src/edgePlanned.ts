/**
 * Belépési pont a fetch-planned-checks edge function bundle-jéhez. Csak fetch-et használ; a
 * PDF-szöveget a hívó adja (az edge functionben `npm:unpdf`), így a bundle kicsi marad.
 */
import { DEFAULT_ENDPOINT, runOverpass } from './overpass';
import { runPlannedChecks, type PlannedDeps, type RunOptions, type RunSummary } from './planned/run';
import { restPlannedStore } from './planned/store';
import { SupabaseRest } from './supabaseRest';

export interface PlannedEdgeEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  overpassEndpoint?: string;
  pdfText: (bytes: Uint8Array) => Promise<string>;
}

const UA = 'atlagsebesseg-app/0.1 (tervezett mérések; +https://atlagsebesseg.vercel.app)';

export function plannedEdgeDeps(env: PlannedEdgeEnv): PlannedDeps {
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };
  return {
    fetchText: async (url) => (await get(url)).text(),
    fetchBytes: async (url) => new Uint8Array(await (await get(url)).arrayBuffer()),
    pdfText: env.pdfText,
    overpass: (query) => runOverpass(query, { endpoint: env.overpassEndpoint ?? DEFAULT_ENDPOINT, retries: 2, userAgent: UA }),
    store: restPlannedStore(new SupabaseRest({ url: env.supabaseUrl, key: env.serviceRoleKey })),
    now: () => new Date(),
  };
}

/** Egy futás + napló (`planned_check_runs`); hiba esetén a naplóba is bekerül, és továbbdobja. */
export async function runFetchPlannedChecks(env: PlannedEdgeEnv, opts: RunOptions = {}): Promise<RunSummary> {
  const deps = plannedEdgeDeps(env);
  try {
    const summary = await runPlannedChecks(deps, opts);
    await deps.store!.logRun(summary.errors.length === 0, summary, summary.errors.join('; ') || undefined);
    return summary;
  } catch (e) {
    await deps.store!.logRun(false, {} as RunSummary, (e as Error).message).catch(() => undefined);
    throw e;
  }
}
