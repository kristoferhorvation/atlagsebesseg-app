/**
 * Az import kimenetének (output/sections.<CC>.json) feltöltése a Supabase `sections` táblába.
 * CSAK HELYI GÉPEN fut, a service role kulccsal (megkerüli az RLS-t) – a kulcs a gyökér .env-ben
 * van, soha nem kerül a repóba vagy az appba.
 *
 *   npm run upload:sections                     # minden output/sections.*.json
 *   npm run upload:sections -- --country IT --dry-run
 *
 * Nem töröl, csak upsert – kivéve a fájl `official.osmDuplicates` listáját: azok az OSM-sorok,
 * amelyeknek hivatalos duplikátuma van (azonos út és irány, ≥ 70% átfedés), és a szabály szerint
 * csak a hivatalos marad (CLAUDE.md). Minden más sor (OSM, közösségi) érintetlen.
 */
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SectionFile } from '../src/output';
import { sectionToRow } from '../src/rows';
import { SupabaseRest } from '../src/supabaseRest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes('--dry-run');
const only = arg('country')?.toUpperCase().split(',');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !key)) {
  console.error('Hiányzik a SUPABASE_URL vagy a SUPABASE_SERVICE_ROLE_KEY (gyökér .env, lásd .env.example).');
  process.exit(1);
}

const outDir = join(here, '..', 'output');
const files = readdirSync(outDir)
  .filter((f) => /^sections\.[A-Z]{2}\.json$/.test(f))
  .filter((f) => !only || only.includes(f.slice(9, 11)));

const db = dryRun ? null : new SupabaseRest({ url: url!, key: key! });
let total = 0;
for (const f of files) {
  const file = JSON.parse(await readFile(join(outDir, f), 'utf8')) as SectionFile;
  const rows = file.sections.map(sectionToRow);
  for (let i = 0; i < rows.length; i += 200) {
    if (db) await db.upsert('sections', rows.slice(i, i + 200), 'id');
  }
  total += rows.length;
  const dups = file.official?.osmDuplicates.map((d) => d.osm) ?? [];
  let removed = 0;
  if (db && dups.length) {
    const list = dups.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
    removed = await db.delete('sections', `country=eq.${file.country}&source=eq.osm&id=in.(${list})`);
  }
  console.log(`${f}: ${rows.length} szakasz ${dryRun ? `(dry-run; ${dups.length} OSM-duplikátum törlődne)` : `feltöltve, ${removed} OSM-duplikátum törölve`}`);
}
console.log(`Összesen: ${total}`);
