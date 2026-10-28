import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAll } from './render';

/** Az iOS-app generált fájljainak kiírása (lásd `render.ts`). */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = renderAll();
for (const [rel, content] of files) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
console.log(`${files.size} generált fájl: ${root}`);
