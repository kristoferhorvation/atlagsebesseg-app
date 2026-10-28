import type { Section } from '@atlagsebesseg/core';
import type { Skipped } from './convert';
import type { OfficialSkip } from './official';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_LICENSE = 'ODbL-1.0 (Open Database License) – https://opendatacommons.org/licenses/odbl/1-0/';

export interface SectionFile {
  country: string;
  generatedAt: string | null;
  source: string;
  attribution: string;
  license: string;
  count: number;
  sections: Section[];
  skipped: Skipped[];
  todo?: string;
  /** Hivatalos import: a források és a lista mérlege (hány tétel, hány került be, mi maradt ki és miért). */
  official?: OfficialSummary;
}

export interface OfficialSummary {
  sources: { name: string; url: string; date: string; note?: string }[];
  /** A hivatalos listán szereplő tételek (irányonként). */
  listed: number;
  included: number;
  skipped: OfficialSkip[];
  /** Bekerült, de megjegyzéssel (pl. a határ az OSM-ből). */
  notes: { id: string; note: string }[];
  /** A fájlban maradt (nem ellenőrzött) OSM-szakaszok száma. */
  osmKept: number;
  /** A hivatalos duplikátumaként kiesett OSM-szakaszok (a DB-ből is törlendők – csak ezek). */
  osmDuplicates: { osm: string; official: string }[];
}

export function sectionFile(country: string, sections: Section[], skipped: Skipped[], generatedAt: string): SectionFile {
  return {
    country,
    generatedAt,
    source: 'OpenStreetMap, Overpass API: relation[type=enforcement][enforcement=average_speed]',
    attribution: OSM_ATTRIBUTION,
    license: OSM_LICENSE,
    count: sections.length,
    sections,
    skipped,
  };
}

/** OSM-ből importált szakasz forrása: a reláció (vagy út) URL-je, az import napja. */
export function osmProvenance(id: string, date: string): import('@atlagsebesseg/core').SectionProvenance {
  const m = /^osm-(w)?(\d+)/.exec(id);
  const url = m ? `https://www.openstreetmap.org/${m[1] ? 'way' : 'relation'}/${m[2]}` : 'https://www.openstreetmap.org/';
  return { name: 'OpenStreetMap', url, date: date.slice(0, 10), locatedBy: 'koordinata' };
}
