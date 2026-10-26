/**
 * Egy importált (valódi OSM-geometriájú) szakaszt teszt-fixtúrává alakít a core számára.
 * Hálózat nem kell hozzá, csak egy korábbi import kimenete.
 *
 *   npm run fixture --workspace @atlagsebesseg/data -- --country IT [--id osm-123456]
 *
 * Kimenet: packages/core/test/fixtures/osm/<id>.json – a core `real-geometry.test.ts` automatikusan felveszi.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SectionFile } from '../src/output';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const cc = (arg('country') ?? 'IT').toUpperCase();
const file = JSON.parse(await readFile(join(here, '..', 'output', `sections.${cc}.json`), 'utf8')) as SectionFile;
const id = arg('id');
// Alapból a leghosszabb szakasz (a legtöbb kanyarral teszteli a vetítést).
const section = id ? file.sections.find((s) => s.id === id) : [...file.sections].sort((a, b) => b.lengthM - a.lengthM)[0];
if (!section) {
  console.error(id ? `Nincs ilyen szakasz: ${id}` : `Üres: sections.${cc}.json – előbb futtasd az importot.`);
  process.exit(1);
}
const outDir = join(here, '..', '..', 'core', 'test', 'fixtures', 'osm');
await mkdir(outDir, { recursive: true });
const out = join(outDir, `${section.id}.json`);
await writeFile(out, JSON.stringify({ attribution: file.attribution, license: file.license, section }, null, 2) + '\n');
console.log(`Fixtúra: ${out} (${section.road} ${section.direction}, ${section.lengthM} m)`);
