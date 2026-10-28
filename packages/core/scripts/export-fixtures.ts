import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFixtures } from '../test/helpers/fixtureSpecs';

/**
 * A közös tesztfixtúrák kiírása a `packages/core/fixtures` mappába (A9). A TS- és a Swift-tesztek
 * (packages/core-swift) ugyanezekből a fájlokból dolgoznak; a régi, már nem leírt vezetéseket törli.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const files = renderFixtures();
mkdirSync(join(root, 'drives'), { recursive: true });
for (const f of readdirSync(join(root, 'drives'))) if (!files.has(`drives/${f}`)) rmSync(join(root, 'drives', f));
for (const [rel, content] of files) writeFileSync(join(root, rel), content);
console.log(`${files.size} fixtúra-fájl: ${root}`);
