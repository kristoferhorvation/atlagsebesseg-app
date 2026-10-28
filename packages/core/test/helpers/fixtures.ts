import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromRow, type RouteFixture, type SampleRow, type SectionsFixture } from './fixtureSpecs';
import type { DriveSample } from './trace';

/** A közös fixtúrák mappája (packages/core/fixtures) – a Swift-tesztek is innen olvasnak. */
export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures', import.meta.url));

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(FIXTURES_DIR, rel), 'utf8')) as T;

export const loadSections = (): SectionsFixture => readJson('sections.json');
export const loadRoute = (): RouteFixture => readJson('route.json');

/** Egy rögzített vezetés mintái (a `drive()` kimenete, a fixtúra-fájlból). */
export function loadDrive(name: string): DriveSample[] {
  return readJson<{ samples: SampleRow[] }>(`drives/${name}.json`).samples.map(fromRow);
}
