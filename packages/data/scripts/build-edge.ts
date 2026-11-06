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
const dataSrc = join(here, '..', 'src');
const bundles = [
  { src: dataSrc, entry: 'edge.ts', outfile: join(functions, 'promote-temp-gates', 'promote.bundle.js') },
  { src: dataSrc, entry: 'edgePlanned.ts', outfile: join(functions, 'fetch-planned-checks', 'planned.bundle.js') },
  // AW25: a fiók-levelek sablonja az app-logic szótárából (6 nyelv), hogy a levél és az app szövege egy helyről jöjjön
  { src: join(here, '..', '..', 'app-logic', 'src'), entry: 'authEmails.ts', outfile: join(functions, 'account-email', 'emails.bundle.js') },
];
for (const b of bundles) {
  await build({
    entryPoints: [join(b.src, b.entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    outfile: b.outfile,
    banner: { js: `// GENERÁLT FÁJL – npm run build:edge (${b.src === dataSrc ? 'packages/data/src' : 'packages/app-logic/src'}/${b.entry}). Ne szerkeszd.` },
  });
  console.log(`Edge bundle: ${b.outfile}`);
}
