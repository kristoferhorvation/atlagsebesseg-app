import type { Section } from '@atlagsebesseg/core';
import pl from '@atlagsebesseg/data/output/sections.PL.json';
import it from '@atlagsebesseg/data/output/sections.IT.json';
import fr from '@atlagsebesseg/data/output/sections.FR.json';
import es from '@atlagsebesseg/data/output/sections.ES.json';
import nl from '@atlagsebesseg/data/output/sections.NL.json';
import at from '@atlagsebesseg/data/output/sections.AT.json';
import hu from '@atlagsebesseg/data/output/sections.HU.json';

interface SectionFile {
  sections: unknown[];
}

/** Az appba csomagolt szakaszok (hivatalos + megmaradó OSM; később: Supabase-ből frissítve). */
export const BUNDLED_SECTIONS: readonly Section[] = [pl, it, fr, es, nl, at, hu].flatMap(
  (f) => (f as SectionFile).sections as Section[],
);
