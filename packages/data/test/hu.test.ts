import { describe, expect, it } from 'vitest';
import { haversineM, type Section } from '@atlagsebesseg/core';
import { manualToSection, mergeSections, validateManualFile, type ManualSectionEntry } from '../src/manual';
import { enforcedWaysQuery, waysToSections } from '../src/ways';
import { at, graph, P, way, ys } from './helpers/synthetic';
import huManual from '../manual/hu-manual.json';

// SZINTETIKUS adatok (nem valódi magyar szakaszok).

describe('waysToSections – címkézett utakból', () => {
  it('a lekérdezés mindkét címkét keresi', () => {
    const q = enforcedWaysQuery('HU');
    expect(q).toContain('"ISO3166-1"="HU"');
    expect(q).toContain('way["maxspeed:enforcement"="average_speed"]');
    expect(q).toContain('way["enforcement"="average_speed"]');
  });

  it('egyirányú, egymáshoz kapcsolódó utak egy szakasszá fűződnek', () => {
    const tags = { highway: 'motorway', ref: 'M1', maxspeed: '130', 'maxspeed:enforcement': 'average_speed', destination: 'Győr' };
    const a = way(11, 5000, ys(0, 3000, 500).map((y) => at(15, y)), tags);
    // a második út az első utolsó node-jával kezdődik
    const bPts = ys(3000, 8000, 500).map((y) => at(15, y));
    const b = { ...way(12, 5100, bPts, tags).way };
    b.nodes = [a.way.nodes[a.way.nodes.length - 1]!, ...b.nodes.slice(1)];
    const { sections, skipped } = waysToSections([a.way, b], 'HU');
    expect(skipped).toEqual([]);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ id: 'osm-w11-12', country: 'HU', road: 'M1', speedLimitKmh: 130, direction: '→ Győr' });
    expect(Math.abs(sections[0]!.lengthM - 8000)).toBeLessThan(5);
    expect(sections[0]!.start.lat).toBeLessThan(sections[0]!.end.lat);
  });

  it('kétirányú út: két ellentétes irányú szakasz', () => {
    const w = way(21, 6000, ys(0, 2000, 500).map((y) => at(0, y)), { highway: 'primary', ref: '8', maxspeed: '90', enforcement: 'average_speed' });
    const { sections } = waysToSections([w.way], 'HU');
    expect(sections.map((s) => s.id).sort()).toEqual(['osm-w21', 'osm-w21r']);
    const r = sections.find((s) => s.id === 'osm-w21r')!;
    expect(r.start.lat).toBeGreaterThan(r.end.lat);
  });

  it('maxspeed nélkül vagy túl röviden kihagyja', () => {
    const noLimit = way(31, 7000, ys(0, 2000, 500).map((y) => at(0, y)), { highway: 'motorway', 'maxspeed:enforcement': 'average_speed' });
    const short = way(32, 7100, [at(500, 0), at(500, 100)], { highway: 'motorway', maxspeed: '130' });
    const { sections, skipped } = waysToSections([noLimit.way, short.way], 'HU');
    expect(sections).toEqual([]);
    expect(skipped.map((s) => s.reason).join(' ')).toMatch(/maxspeed.*túl rövid|túl rövid.*maxspeed/s);
  });
});

const entry = (over: Partial<ManualSectionEntry> = {}): ManualSectionEntry => ({
  id: 'hu-teszt-1',
  road: 'A22',
  direction: 'Dél → Észak',
  start: at(14, 0),
  end: at(16, 10000),
  headingDeg: 0,
  speedLimitKmh: 130,
  source: 'hivatalos',
  verified: true,
  reference: 'szintetikus teszt',
  ...over,
});

describe('hu-manual.json', () => {
  it('a repóban lévő fájl érvényes', () => {
    expect(validateManualFile(huManual).errors).toEqual([]);
  });

  it('hibás bejegyzéseket jelez', () => {
    const { errors } = validateManualFile({
      country: 'hu',
      sections: [
        entry({ speedLimitKmh: 500 }),
        entry({ id: 'hu-teszt-1', reference: '' }),
        entry({ id: 'x', headingDeg: 180 }),
        entry({ id: 'y', end: at(14, 100) }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toMatch(/country/);
    expect(all).toMatch(/speedLimitKmh/);
    expect(all).toMatch(/ismétlődő id/);
    expect(all).toMatch(/reference/);
    expect(all).toMatch(/ellentmond/);
    expect(all).toMatch(/túl közel/);
  });

  it('kézi bejegyzés → Section az úthálózat geometriájával (helyes pályatest)', () => {
    const { section, warning } = manualToSection(entry(), 'HU', graph);
    expect(warning).toBeUndefined();
    expect(section).toMatchObject({ id: 'hu-teszt-1', source: 'hivatalos', verified: true, speedLimitKmh: 130 });
    expect(Math.abs(section.lengthM - 10_000)).toBeLessThan(5);
    for (const p of section.geometry!) expect(Math.abs(P.toXY(p).x - 15)).toBeLessThan(2);
  });

  it('a hivatalos hossz felülírja a számoltat; úthálózat nélkül geometria nélkül, figyelmeztetéssel', () => {
    expect(manualToSection(entry({ lengthM: 10_120 }), 'HU', graph).section.lengthM).toBe(10_120);
    const r = manualToSection(entry(), 'HU');
    expect(r.section.geometry).toBeUndefined();
    expect(r.warning).toMatch(/geometria nélkül/);
  });

  it('eltérő útszám esetén figyelmeztet', () => {
    expect(manualToSection(entry({ road: 'M7' }), 'HU', graph).warning).toMatch(/A22/);
  });
});

describe('mergeSections', () => {
  const osm = (id: string, dy = 0, geometry = true): Section => ({
    id,
    country: 'HU',
    road: 'A22',
    direction: '',
    start: at(15, dy),
    end: at(15, 10000 + dy),
    lengthM: 10000,
    speedLimitKmh: 130,
    source: 'osm',
    verified: false,
    geometry: geometry ? [at(15, dy), at(15, 10000 + dy)] : undefined,
  });

  it('egyezésnél a kézi nyer, és megkapja az OSM-geometriát', () => {
    const manual = manualToSection(entry(), 'HU').section; // geometria nélkül
    const { sections, replaced } = mergeSections([osm('osm-1', 100), osm('osm-2', 20_000)], [manual]);
    expect(replaced).toEqual(['osm-1']);
    expect(sections.map((s) => s.id)).toEqual(['hu-teszt-1', 'osm-2']);
    expect(sections[0]!.geometry).toHaveLength(2);
    expect(sections[0]!.source).toBe('hivatalos');
  });

  it('300 m-nél távolabbi kapuk nem egyeznek', () => {
    const manual = manualToSection(entry(), 'HU').section;
    const { sections } = mergeSections([osm('osm-1', 600)], [manual]);
    expect(sections).toHaveLength(2);
    expect(haversineM(sections[0]!.start, sections[1]!.start)).toBeGreaterThan(300);
  });
});
