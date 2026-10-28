/**
 * Hivatalos szakaszellenőrzés-listák importja (A6). Alapelv: CSAK biztos adat – ami nem
 * azonosítható egyértelműen vagy nem illeszthető útvonalra, kimarad, és a kimenet
 * `official.skipped` listájába kerül okkal.
 *
 *   npm run import:official                         # PL,IT,FR,ES,NL,AT
 *   npm run import:official -- --country IT --refresh
 *
 * Országonként: a forrás letöltése (cache/), helymeghatározás (koordináta / km-szelvény),
 * útvonal az OSM-úthálózaton, ellenőrzés (`evaluateOfficial`), kimenet: output/sections.<CC>.json.
 * Összefésülés az OSM-réteggel (osm/sections.<CC>.json): a hivatalos elsőbbséget élvez; az
 * OSM-szakasz nem ellenőrzöttként megmarad, hacsak nem duplikátum (azonos út és irány, ≥ 70%
 * geometriai átfedés) – akkor csak a hivatalos marad. Ausztria: a meglévő OSM-szakaszok maradnak,
 * és ami egyezik az ASFINAG/RIS-listával, ellenőrzött lesz.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Section } from '@atlagsebesseg/core';
import { bboxAround } from '../src/convert';
import { RoadGraph } from '../src/graph';
import { sameSection } from '../src/manual';
import { evaluateOfficial, mergeOfficialWithOsm, type OfficialSkip } from '../src/official';
import { OSM_ATTRIBUTION, OSM_LICENSE, osmProvenance, type SectionFile } from '../src/output';
import { roadsQuery, type OsmWay } from '../src/overpass';
import { createContext, type CountryImporter } from './official/context';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const IMPORTERS: Record<string, () => Promise<CountryImporter>> = {
  PL: async () => (await import('./official/pl')).importPL,
  IT: async () => (await import('./official/it')).importIT,
  FR: async () => (await import('./official/fr')).importFR,
  ES: async () => (await import('./official/es')).importES,
  NL: async () => (await import('./official/nl')).importNL,
  AT: async () => (await import('./official/at')).importAT,
};

const countries = (arg('country') ?? Object.keys(IMPORTERS).join(',')).split(',').map((c) => c.trim().toUpperCase());
const refresh = process.argv.includes('--refresh');
const endpoint = arg('endpoint') ?? process.env.OVERPASS_ENDPOINT;
const delayMs = Number(arg('delay') ?? 1500);

async function run(cc: string) {
  const importer = IMPORTERS[cc];
  if (!importer) throw new Error(`nincs importer: ${cc}`);
  const ctx = createContext(cc, { refresh, endpoint, delayMs });
  const load = await (await importer())(ctx);
  ctx.log(`hivatalos lista: ${load.listed} tétel, ebből helyhez kötve ${load.items.length}, előre kihagyva ${load.skipped.length}`);

  const sections: Section[] = [];
  const skipped: OfficialSkip[] = [...load.skipped];
  const notes: { id: string; note: string }[] = [];
  const graphs = new Map<string, RoadGraph>();
  for (const item of load.items) {
    const b = bboxAround([item.start, item.end], 2000);
    const key = [b.south, b.west, b.north, b.east].map((x) => x.toFixed(3)).join(',');
    let graph = graphs.get(key);
    if (!graph) {
      const res = await ctx.overpass(roadsQuery(b, { minor: load.minorRoads }));
      graph = new RoadGraph(res.elements.filter((e): e is OsmWay => e.type === 'way'));
      graphs.set(key, graph);
    }
    const r = evaluateOfficial(item, graph, { snapRadiusM: load.snapRadiusM });
    if (!r.ok) {
      skipped.push(r.skip);
      ctx.log(`kihagyva: ${item.label} – ${r.skip.reason}`);
      continue;
    }
    const dup = sections.find((s) => sameSection(s, r.section, 100));
    if (dup) {
      skipped.push({ id: item.id, label: item.label, reason: `ugyanaz a szakasz, mint ${dup.id} (a forrás kétszer listázza)` });
      continue;
    }
    sections.push(r.section);
    if (r.note) notes.push({ id: item.id, note: r.note });
    for (const n of load.notes ?? []) if (n.id === item.id) notes.push(n);
    ctx.log(`OK: ${item.label} – ${(r.section.lengthM / 1000).toFixed(2)} km, ${r.section.speedLimitKmh} km/h`);
  }

  // OSM-réteg: a hivatalos elsőbbséget élvez, a nem duplikátum OSM-szakaszok maradnak
  let all: Section[];
  let duplicates: { osm: string; official: string }[] = [];
  let osmKept = 0;
  if (load.keep) {
    all = [...sections, ...load.keep].sort((a, b) => a.id.localeCompare(b.id));
    osmKept = load.keep.length;
  } else {
    const osmPath = join(here, '..', 'osm', `sections.${cc}.json`);
    const osmFile = existsSync(osmPath) ? (JSON.parse(await readFile(osmPath, 'utf8')) as SectionFile) : null;
    const osm = (osmFile?.sections ?? []).map((s) => (s.provenance ? s : { ...s, provenance: osmProvenance(s.id, osmFile?.generatedAt ?? new Date().toISOString()) }));
    const merged = mergeOfficialWithOsm(sections, osm);
    all = merged.sections;
    duplicates = merged.duplicates;
    osmKept = osm.length - duplicates.length;
    ctx.log(`OSM-réteg: ${osm.length} szakasz, ebből ${duplicates.length} duplikátum (kiesett), ${osmKept} marad`);
  }
  const file: SectionFile = {
    country: cc,
    generatedAt: new Date().toISOString(),
    source: `Hivatalos lista: ${load.sources.map((s) => s.name).join(', ')}; geometria: OpenStreetMap`,
    attribution: `${load.sources.map((s) => s.name).join(', ')}; ${OSM_ATTRIBUTION}`,
    license: OSM_LICENSE,
    count: all.length,
    sections: all,
    skipped: [],
    official: { sources: load.sources, listed: load.listed, included: load.included ?? sections.length, skipped, notes, osmKept, osmDuplicates: duplicates },
  };
  await writeFile(join(here, '..', 'output', `sections.${cc}.json`), JSON.stringify(file, null, 2) + '\n');
  const included = load.included ?? sections.length;
  ctx.log(`kész: ${included} hivatalos tétel bekerült / egyezik, ${skipped.length} kimaradt`);
  return { cc, listed: load.listed, included, skipped: skipped.length, osmKept, osmDuplicates: duplicates.length };
}

const summary = [];
for (const cc of countries) summary.push(await run(cc));
console.table(summary);
