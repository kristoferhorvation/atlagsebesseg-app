import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from './helpers/fixtures';
import { renderFixtures } from './helpers/fixtureSpecs';

/**
 * A közös fixtúrák frissessége: a lemezen lévő JSON-fájlok pontosan azok, amiket a leírás
 * (`fixtureSpecs.ts`) most előállít. Ha bukik: `npm run fixtures -w @atlagsebesseg/core`, és a Swift-
 * tesztek (packages/core-swift) is az új fájlokon futnak.
 */
describe('közös fixtúrák (TS ↔ Swift)', () => {
  it('a packages/core/fixtures friss', () => {
    for (const [rel, content] of renderFixtures()) {
      expect(readFileSync(join(FIXTURES_DIR, rel), 'utf8'), rel).toBe(content);
    }
  });
});
