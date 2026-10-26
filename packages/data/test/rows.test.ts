import { describe, expect, it } from 'vitest';
import type { Section } from '@atlagsebesseg/core';
import { rowToSection, sectionToRow } from '../src/rows';

const s: Section = {
  id: 'osm-1',
  country: 'it',
  road: 'A1',
  direction: 'Bologna → Firenze',
  start: { lat: 44.4, lon: 11.2 },
  end: { lat: 44.3, lon: 11.25 },
  lengthM: 12000.4,
  speedLimitKmh: 130,
  source: 'osm',
  verified: false,
  geometry: [{ lat: 44.4, lon: 11.2 }, { lat: 44.35, lon: 11.22 }, { lat: 44.3, lon: 11.25 }],
};

describe('sections sor ↔ Section', () => {
  it('oda-vissza (GeoJSON [lon, lat] sorrend, nagybetűs ország, egész hossz)', () => {
    const row = sectionToRow(s);
    expect(row.geometry![0]).toEqual([11.2, 44.4]);
    expect(row).toMatchObject({ country: 'IT', length_m: 12000, start_lat: 44.4, end_lon: 11.25 });
    expect(rowToSection(row)).toEqual({ ...s, country: 'IT', lengthM: 12000 });
  });

  it('geometria nélkül null, és visszafelé nincs geometry mező', () => {
    const row = sectionToRow({ ...s, geometry: undefined });
    expect(row.geometry).toBeNull();
    expect('geometry' in rowToSection(row)).toBe(false);
  });
});
