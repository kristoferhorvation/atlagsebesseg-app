/**
 * Magyar fix kamerák importja (A7). Csak biztos adat:
 *  - forrás 1: az ORFK 2015-ös fix VÉDA-listája (Zsaru Magazin 2015/48, két PDF a police.hu-n),
 *  - forrás 2: az OSM `highway=speed_camera` csomópontjai Magyarországon (Overpass).
 * Mindkettőben (≤ 300 m) → `complex`, ellenőrzött; csak OSM → `speed`, nem ellenőrzött; csak a
 * 2015-ös listában → kimarad, és a kimenet `skipped` listájába kerül.
 *
 *   npm run import:cameras                      # letöltés (cache/), egyesítés → output/cameras.HU.json
 *   npm run import:cameras -- --refresh         # a gyorsítótár (PDF, Overpass) újratöltése
 *   npm run import:cameras -- --upload          # + feltöltés a `cameras` táblába (service role, gyökér .env)
 */
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';
import { mergeCameras, parseVedaList, speedCamerasQuery, VEDA_SOURCE, type CameraRow } from '../src/cameras';
import { OSM_ATTRIBUTION, OSM_LICENSE } from '../src/output';
import { runOverpass, type OsmNode, type OverpassResponse } from '../src/overpass';
import { SupabaseRest } from '../src/supabaseRest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const cacheDir = join(here, '..', 'cache', 'veda');
const outFile = join(here, '..', 'output', 'cameras.HU.json');
const refresh = process.argv.includes('--refresh');
const upload = process.argv.includes('--upload');
const UA = 'atlagsebesseg-app-import/0.1 (+https://github.com/)';

async function cached(name: string, load: () => Promise<Uint8Array | string>): Promise<Buffer> {
  const file = join(cacheDir, name);
  if (refresh || !existsSync(file)) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, await load());
  }
  return readFile(file);
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// 1. A 2015-ös lista (két PDF, egymás után)
let vedaText = '';
for (const url of VEDA_SOURCE.pdfs) {
  const pdf = await getDocumentProxy(new Uint8Array(await cached(url.split('/').pop()!, () => download(url))));
  vedaText += (await extractText(pdf, { mergePages: true })).text + '\n';
}
const veda = parseVedaList(vedaText);
const byCounty = new Map<string, number>();
for (const p of veda) byCounty.set(p.county, (byCounty.get(p.county) ?? 0) + 1);
console.log(`VÉDA 2015: ${veda.length} pont, ${byCounty.size} megye/Budapest`);

// 2. OSM-kamerák (a lekérés napja a forrás dátuma)
const osmRaw = await cached('osm-speed-cameras-HU.json', async () =>
  JSON.stringify(await runOverpass(speedCamerasQuery('HU'), { userAgent: UA })),
);
const osmFile = join(cacheDir, 'osm-speed-cameras-HU.json');
const osmDate = statSync(osmFile).mtime.toISOString().slice(0, 10);
const osm = (JSON.parse(osmRaw.toString('utf8')) as OverpassResponse).elements.filter((e): e is OsmNode => e.type === 'node');
console.log(`OSM highway=speed_camera: ${osm.length} csomópont (${osmDate})`);

// 3. Egyesítés
const { rows, skipped, matches } = mergeCameras(veda, osm, osmDate);
const vedaIn = rows.filter((r) => r.type === 'complex').length;
console.log(`Bekerült: ${rows.length} kamera (VÉDA ellenőrzött: ${vedaIn}, csak OSM: ${rows.length - vedaIn}); kimaradt VÉDA-pont: ${skipped.length}`);
for (const s of skipped) console.log(`  kimaradt: ${s.point.county} – ${s.point.raw} (${s.reason}${s.nearestM !== null ? `; legközelebbi ${s.nearestM} m` : ''})`);

await writeFile(
  outFile,
  JSON.stringify(
    {
      country: 'HU',
      generatedAt: new Date().toISOString(),
      sources: [
        { name: VEDA_SOURCE.name, url: VEDA_SOURCE.url, files: VEDA_SOURCE.pdfs, date: VEDA_SOURCE.date },
        { name: `OpenStreetMap highway=speed_camera (${OSM_ATTRIBUTION})`, url: 'https://overpass-api.de/', date: osmDate, license: OSM_LICENSE },
      ],
      counts: { veda: veda.length, osm: osm.length, rows: rows.length, vedaVerified: vedaIn, osmOnly: rows.length - vedaIn, vedaSkipped: skipped.length },
      cameras: rows,
      skipped: skipped.map((s) => ({ n: s.point.n, county: s.point.county, line: s.point.raw, reason: s.reason, nearestM: s.nearestM })),
      matches,
    },
    null,
    1,
  ) + '\n',
);
console.log(`Kimenet: ${outFile}`);

// 4. Feltöltés (upsert id szerint; nem töröl)
if (upload) {
  const envFile = join(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Hiányzik a SUPABASE_URL vagy a SUPABASE_SERVICE_ROLE_KEY (gyökér .env)');
  const db = new SupabaseRest({ url, key });
  for (let i = 0; i < rows.length; i += 200) await db.upsert('cameras', rows.slice(i, i + 200) satisfies CameraRow[], 'id');
  const live = await db.select<{ id: string; type: string; verified: boolean }>('cameras', 'select=id,type,verified&country=eq.HU');
  console.log(`Élőben: ${live.length} HU-kamera (ellenőrzött: ${live.filter((r) => r.verified).length})`);
}
