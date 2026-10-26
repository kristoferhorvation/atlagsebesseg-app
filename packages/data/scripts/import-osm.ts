/**
 * Átlagsebesség-mérő szakaszok importja az OpenStreetMapből (Overpass API).
 *
 *   npm run import --workspace @atlagsebesseg/data -- --country IT,AT
 *   npm run import --workspace @atlagsebesseg/data -- --country IT --limit 5 --endpoint https://overpass.kumi.systems/api/interpreter
 *
 * Kimenet: output/sections.<CC>.json (ODbL – lásd output/ATTRIBUTION.md).
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
import { sectionFile } from '../src/output';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const countries = (arg('country') ?? 'IT,AT').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
const endpoint = arg('endpoint') ?? process.env.OVERPASS_ENDPOINT ?? DEFAULT_ENDPOINT;
const outDir = arg('out') ?? join(here, '..', 'output');
const limit = arg('limit') ? Number(arg('limit')) : Infinity;
const delayMs = Number(arg('delay') ?? 1500);

async function importCountry(cc: string) {
  console.log(`[${cc}] relációk lekérdezése: ${endpoint}`);
  const res = await runOverpass(relationsQuery(cc), { endpoint });
  const nodes = new Map<number, OsmNode>();
  const relations: OsmRelation[] = [];
  for (const el of res.elements) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'relation') relations.push(el);
  }
  console.log(`[${cc}] ${relations.length} reláció, ${nodes.size} tag-node`);

  const sections: Section[] = [];
  const skipped: Skipped[] = [];
  for (const rel of relations.slice(0, limit)) {
    const memberNodes = rel.members.map((m) => nodes.get(m.ref)).filter((n): n is OsmNode => !!n && n.type === 'node');
    if (memberNodes.length < 2) {
      skipped.push({ relationId: rel.id, reason: 'kettőnél kevesebb node-tag' });
      continue;
    }
    try {
      await sleep(delayMs);
      const roads = await runOverpass(roadsQuery(bboxAround(memberNodes, 1500)), { endpoint });
      const graph = new RoadGraph(roads.elements.filter((e): e is OsmWay => e.type === 'way'));
      const r = buildSection(rel, nodes, graph, cc);
      if (r.ok) sections.push(r.section);
      else skipped.push(r.skipped);
      console.log(`[${cc}] r${rel.id}: ${r.ok ? `OK ${r.section.road} ${r.section.lengthM} m ${r.section.speedLimitKmh} km/h` : `kihagyva – ${r.skipped.reason}`}`);
    } catch (e) {
      skipped.push({ relationId: rel.id, reason: `lekérdezési hiba: ${(e as Error).message}` });
    }
  }
  sections.sort((a, b) => a.id.localeCompare(b.id));
  const file = sectionFile(cc, sections, skipped, new Date().toISOString());
  await writeFile(join(outDir, `sections.${cc}.json`), JSON.stringify(file, null, 2) + '\n');
  console.log(`[${cc}] kész: ${sections.length} szakasz, ${skipped.length} kihagyva → sections.${cc}.json`);
  return { cc, ok: sections.length, skipped: skipped.length };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const summary = [];
  for (const cc of countries) {
    if (cc === 'HU') {
      console.log('[HU] kihagyva: a hivatalos listából töltjük (lásd output/sections.HU.json todo)');
      continue;
    }
    summary.push(await importCountry(cc));
  }
  console.table(summary);
}

main().catch((e) => {
  console.error('Az import nem sikerült:', e);
  console.error('Ha a hálózat nem éri el az Overpass API-t, futtasd helyi gépen, vagy adj meg másik végpontot: --endpoint <url>');
  process.exit(1);
});
