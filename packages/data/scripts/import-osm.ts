/**
 * Átlagsebesség-mérő szakaszok importja az OpenStreetMapből (Overpass API).
 *
 *   npm run import --workspace @atlagsebesseg/data -- --country IT,AT
 *   npm run import --workspace @atlagsebesseg/data -- --country IT --limit 5 --endpoint https://overpass.kumi.systems/api/interpreter
 *   (két szerveren párhuzamosan: --from 0 --limit 117 --out <a>, ill. --from 117 --out <b>, majd a két fájl összefésülése)
 *
 *   npm run import:sections -- --country HU
 *
 * Forrásonként: (1) enforcement=average_speed relációk, (2) maxspeed:enforcement / enforcement
 * címkéjű utak, (3) ha létezik, a manual/<cc>-manual.json kézi lista – ezeket összefésüli.
 * Kimenet: osm/sections.<CC>.json (ODbL – lásd output/ATTRIBUTION.md); az appba kerülő
 * output/sections.<CC>.json-t az import-official fésüli össze a hivatalos listával.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Section } from '@atlagsebesseg/core';
import { bboxAround, buildSection, type Skipped } from '../src/convert';
import { RoadGraph } from '../src/graph';
import {
  DEFAULT_ENDPOINT,
  relationsQuery,
  roadsQuery,
  runOverpass,
  sleep,
  type OsmNode,
  type OsmRelation,
  type OsmWay,
} from '../src/overpass';
import { osmProvenance, sectionFile } from '../src/output';
import { manualToSection, mergeSections, sameSection, validateManualFile } from '../src/manual';
import { enforcedWaysQuery, waysToSections } from '../src/ways';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const countries = (arg('country') ?? 'IT,AT,HU').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
const endpoint = arg('endpoint') ?? process.env.OVERPASS_ENDPOINT ?? DEFAULT_ENDPOINT;
// A6: az OSM-réteg külön (osm/); az output/ a hivatalos + OSM összefésülése (import-official)
const outDir = arg('out') ?? join(here, '..', 'osm');
const limit = arg('limit') ? Number(arg('limit')) : Infinity;
// párhuzamos futáshoz: a relációk azonosító szerint rendezve, `--from`-tól `--limit` darab
const from = Number(arg('from') ?? 0);
const delayMs = Number(arg('delay') ?? 1500);

async function importCountry(cc: string) {
  console.log(`[${cc}] relációk lekérdezése: ${endpoint}`);
  const res = await runOverpass(relationsQuery(cc), { endpoint, retries: 7, backoffMs: 5000 });
  const nodes = new Map<number, OsmNode>();
  const relations: OsmRelation[] = [];
  for (const el of res.elements) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'relation') relations.push(el);
  }
  console.log(`[${cc}] ${relations.length} reláció, ${nodes.size} tag-node`);

  const sections: Section[] = [];
  const skipped: Skipped[] = [];
  relations.sort((a, b) => a.id - b.id);
  for (const rel of relations.slice(from, from + limit)) {
    const memberNodes = rel.members.map((m) => nodes.get(m.ref)).filter((n): n is OsmNode => !!n && n.type === 'node');
    if (memberNodes.length < 2) {
      skipped.push({ relationId: rel.id, reason: 'kettőnél kevesebb node-tag' });
      continue;
    }
    try {
      await sleep(delayMs);
      const roads = await runOverpass(roadsQuery(bboxAround(memberNodes, 1500)), { endpoint, retries: 7, backoffMs: 5000 });
      const graph = new RoadGraph(roads.elements.filter((e): e is OsmWay => e.type === 'way'));
      const r = buildSection(rel, nodes, graph, cc);
      if (r.ok) sections.push(r.section);
      else skipped.push(r.skipped);
      console.log(`[${cc}] r${rel.id}: ${r.ok ? `OK ${r.section.road} ${r.section.lengthM} m ${r.section.speedLimitKmh} km/h` : `kihagyva – ${r.skipped.reason}`}`);
    } catch (e) {
      skipped.push({ relationId: rel.id, reason: `lekérdezési hiba: ${(e as Error).message}` });
    }
  }
  // (2) címkézett utak – ami relációként már megvan, azt nem duplikáljuk
  await sleep(delayMs);
  const tagged = await runOverpass(enforcedWaysQuery(cc), { endpoint, retries: 7, backoffMs: 5000 });
  const fromWays = waysToSections(tagged.elements.filter((e): e is OsmWay => e.type === 'way'), cc);
  skipped.push(...fromWays.skipped);
  const newFromWays = fromWays.sections.filter((w) => !sections.some((r) => sameSection(r, w)));
  sections.push(...newFromWays);
  console.log(`[${cc}] címkézett utakból: ${fromWays.sections.length} szakasz (${newFromWays.length} új)`);

  // (3) kézi lista
  let result = sections;
  const manualPath = join(here, '..', 'manual', `${cc.toLowerCase()}-manual.json`);
  if (existsSync(manualPath)) {
    const { file: manual, errors } = validateManualFile(JSON.parse(await readFile(manualPath, 'utf8')));
    if (!manual) throw new Error(`${manualPath} hibás:\n${errors.join('\n')}`);
    const manualSections = [];
    for (const entry of manual.sections) {
      await sleep(delayMs);
      const roads = await runOverpass(roadsQuery(bboxAround([entry.start, entry.end], 1500)), { endpoint, retries: 7, backoffMs: 5000 });
      const graph = new RoadGraph(roads.elements.filter((e): e is OsmWay => e.type === 'way'));
      const r = manualToSection(entry, cc, graph);
      if (r.warning) console.warn(`[${cc}] figyelmeztetés: ${r.warning}`);
      manualSections.push(r.section);
    }
    const merged = mergeSections(sections, manualSections);
    result = merged.sections;
    console.log(`[${cc}] kézi lista: ${manualSections.length} szakasz, ${merged.replaced.length} OSM-szakaszt váltott ki`);
  }

  result.sort((a, b) => a.id.localeCompare(b.id));
  const generatedAt = new Date().toISOString();
  // A6: minden szakasznak van forrása – az OSM-eseknél a reláció/út és az import napja
  result = result.map((s) => (s.source === 'osm' && !s.provenance ? { ...s, provenance: osmProvenance(s.id, generatedAt) } : s));
  const file = sectionFile(cc, result, skipped, generatedAt);
  await writeFile(join(outDir, `sections.${cc}.json`), JSON.stringify(file, null, 2) + '\n');
  console.log(`[${cc}] kész: ${result.length} szakasz, ${skipped.length} kihagyva → sections.${cc}.json`);
  return { cc, ok: result.length, skipped: skipped.length };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const summary = [];
  for (const cc of countries) {
    summary.push(await importCountry(cc));
  }
  console.table(summary);
}

main().catch((e) => {
  console.error('Az import nem sikerült:', e);
  console.error('Ha a hálózat nem éri el az Overpass API-t, futtasd helyi gépen, vagy adj meg másik végpontot: --endpoint <url>');
  process.exit(1);
});
