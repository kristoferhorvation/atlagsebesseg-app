/**
 * A fetch-planned-checks edge function logikája helyben (ugyanaz a kód: src/planned/*), időkorlát
 * nélkül – nagy listához (pl. Speedmarathon, ~1000 sor) vagy ha a police.hu a Supabase-szerverről
 * nem érhető el. Az Overpass-válaszok a cache/overpass/ alá kerülnek (újrafuttatáshoz).
 *
 *   npm run planned:fetch                                   # hírlista → jelöltek, száraz futás
 *   npm run planned:fetch -- --upload                       # + írás a planned_checks táblába (service role)
 *   npm run planned:fetch -- --article <url> --as-of 2026-04-14   # egy adott cikk, adott „mai” nappal
 *   npm run planned:fetch -- ... --json out.json            # a teljes összegzés fájlba
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';
import { runOverpass, type OverpassResponse } from '../src/overpass';
import { runPlannedChecks, type PlannedDeps } from '../src/planned/run';
import { restPlannedStore } from '../src/planned/store';
import { SupabaseRest } from '../src/supabaseRest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const cacheDir = join(here, '..', 'cache', 'overpass');
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const UA = 'atlagsebesseg-app-import/0.1 (+https://github.com/)';
const asOf = arg('as-of');
const article = arg('article');

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function overpassCached(query: string): Promise<OverpassResponse> {
  const file = join(cacheDir, `${createHash('sha1').update(query).digest('hex')}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) as OverpassResponse;
  const res = await runOverpass(query, { userAgent: UA, retries: 5, backoffMs: 5000 });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify(res));
  return res;
}

let store: PlannedDeps['store'];
if (process.argv.includes('--upload')) {
  const envFile = join(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Hiányzik a SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (gyökér .env)');
  store = restPlannedStore(new SupabaseRest({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }));
}

let queries = 0;
const summary = await runPlannedChecks(
  {
    fetchText: async (url) => (await get(url)).text(),
    fetchBytes: async (url) => new Uint8Array(await (await get(url)).arrayBuffer()),
    pdfText: async (bytes) => (await extractText(await getDocumentProxy(bytes), { mergePages: true })).text,
    overpass: (q) => {
      queries++;
      if (queries % 25 === 0) console.error(`… ${queries} Overpass-lekérés`);
      return overpassCached(q);
    },
    store,
    now: () => (asOf ? new Date(`${asOf}T12:00:00Z`) : new Date()),
  },
  { articleUrls: article ? [article] : undefined },
);

console.log(`Hírlista: ${summary.listingItems} hír, ebből jelölt: ${summary.candidates}`);
for (const a of summary.articles) console.log(`  [${a.status}] ${a.title || a.url}${a.period ? ` · ${a.period}` : ''} – ${a.rows} sor, ${a.skipped} kimaradt`);
console.log(`\nMegyénként (sor / nem elhelyezhető):`);
for (const [c, s] of Object.entries(summary.counties).sort((a, b) => a[0].localeCompare(b[0], 'hu'))) {
  console.log(`  ${c}: ${s.rows} / ${s.skipped.length}`);
}
console.log(`Összesen: ${summary.rows} sor, ${summary.skipped} nem elhelyezhető; ${queries} Overpass-lekérés${summary.errors.length ? `; HIBÁK: ${summary.errors.join(' | ')}` : ''}`);
if (store) console.log(`Törölve: ${summary.deletedExpired} lejárt, ${summary.deletedStale} elavult`);
const out = arg('json');
if (out) await writeFile(out, JSON.stringify(summary, null, 1));
