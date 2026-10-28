/**
 * A data csomag edge-belépési pontjait (src/edge.ts, src/edgePlanned.ts) egy-egy ESM-fájlba
 * csomagolja a supabase/functions/<függvény>/ alá, mert a Deno nem oldja fel a workspace-csomagokat
 * és a kiterjesztés nélküli importokat. Generált fájl – nincs a repóban, deploy előtt készül.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const functions = join(here, '..', '..', '..', 'supabase', 'functions');
const bundles = [
  { entry: 'edge.ts', outfile: join(functions, 'promote-temp-gates', 'promote.bundle.js') },
  { entry: 'edgePlanned.ts', outfile: join(functions, 'fetch-planned-checks', 'planned.bundle.js') },
];
for (const b of bundles) {
  await build({
    entryPoints: [join(here, '..', 'src', b.entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    outfile: b.outfile,
    banner: { js: `// GENERÁLT FÁJL – npm run build:edge (packages/data/src/${b.entry}). Ne szerkeszd.` },
  });
  console.log(`Edge bundle: ${b.outfile}`);
}
