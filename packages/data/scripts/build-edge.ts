/**
 * A data csomag edge-belépési pontját (src/edge.ts) egyetlen ESM-fájlba csomagolja a
 * supabase/functions/promote-temp-gates/ alá, mert a Deno nem oldja fel a workspace-csomagokat
 * és a kiterjesztés nélküli importokat. Generált fájl – nincs a repóban, deploy előtt készül.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, '..', '..', '..', 'supabase', 'functions', 'promote-temp-gates', 'promote.bundle.js');
await build({
  entryPoints: [join(here, '..', 'src', 'edge.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  outfile,
  banner: { js: '// GENERÁLT FÁJL – npm run build:edge (packages/data/src/edge.ts). Ne szerkeszd.' },
});
console.log(`Edge bundle: ${outfile}`);
