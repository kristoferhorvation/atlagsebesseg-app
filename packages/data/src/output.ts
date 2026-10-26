import type { Section } from '@atlagsebesseg/core';
import type { Skipped } from './convert';

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
