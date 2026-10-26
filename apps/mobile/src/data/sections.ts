import type { Section } from '@atlagsebesseg/core';
import it from '@atlagsebesseg/data/output/sections.IT.json';
import at from '@atlagsebesseg/data/output/sections.AT.json';
import hu from '@atlagsebesseg/data/output/sections.HU.json';

interface SectionFile {
  sections: unknown[];
}

/** Az appba csomagolt szakaszok (később: Supabase-ből frissítve). */
export const BUNDLED_SECTIONS: readonly Section[] = [it, at, hu].flatMap(
  (f) => (f as SectionFile).sections as Section[],
);
