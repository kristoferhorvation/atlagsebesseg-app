import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LocalProjection, type XY } from '../src/geo';
import { Route } from '../src/route';
import { SectionTracker, type TrackerState } from '../src/tracker';
import type { Section } from '../src/types';
import { drive, fixes, trueTimeAt } from './helpers/trace';

/**
 * Valódi OSM-geometrián futó tesztek. A fixtúrákat a data csomag állítja elő:
 *   npm run import  --workspace @atlagsebesseg/data -- --country IT
 *   npm run fixture --workspace @atlagsebesseg/data -- --country IT
 * Fixtúra nélkül a tesztek kihagyva (skip) jelennek meg.
 */
const dir = fileURLToPath(new URL('./fixtures/osm', import.meta.url));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
const sections: Section[] = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).section);

/** Rávezető és kivezető szakasz az első/utolsó szegmens meghosszabbításával. */
function withLeads(s: Section, leadM: number) {
  const g = s.geometry!;
  const p = new LocalProjection(g[0]!);
  const xy = g.map((q) => p.toXY(q));
  const ext = (a: XY, b: XY, d: number): XY => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: b.x + ((b.x - a.x) / len) * d, y: b.y + ((b.y - a.y) / len) * d };
  };
  const before = ext(xy[1]!, xy[0]!, leadM);
  const after = ext(xy[xy.length - 2]!, xy[xy.length - 1]!, leadM);
  return [before, ...xy, after].map((q) => p.fromXY(q));
}

describe.skipIf(sections.length === 0)('valódi OSM-geometria (olasz Tutor)', () => {
  it.each(sections.map((s) => [s.id, s] as const))('%s: áthaladás 120 km/h, átlag ±0,5', (_id, section) => {
    expect(section.geometry?.length).toBeGreaterThan(1);
    const lead = 2500;
    const path = withLeads(section, lead);
    const samples = drive({ path, speedKmh: () => 120, noiseM: 5, seed: 42 });
    const tracker = new SectionTracker([section]);
    const states: TrackerState[] = [];
    let last = tracker.snapshot(0);
    for (const f of fixes(samples)) {
      last = tracker.update(f);
      states.push(...last.transitions.map((t) => t.to));
    }
    expect(states.slice(0, 3)).toEqual(['kozeledik', 'szakaszon', 'kesz']);
    // A tracker a névleges hosszra skáláz; a vezetés a geometriai hosszon fut.
    const geomLen = new Route(section.geometry!).lengthM;
    const t = (trueTimeAt(samples, lead + geomLen) - trueTimeAt(samples, lead)) / 1000;
    const expected = (section.lengthM / t) * 3.6;
    expect(Math.abs(last.lastResult!.averageKmh - expected)).toBeLessThan(0.5);
  });
});

describe('valódi OSM-geometria – fixtúra', () => {
  // Kihagyva (skip) jelenik meg, amíg az import nem futott le és nincs fixtúra.
  it.skipIf(sections.length === 0)('van legalább egy olasz OSM-fixtúra', () => {
    expect(sections.some((s) => s.country === 'IT')).toBe(true);
  });
});
