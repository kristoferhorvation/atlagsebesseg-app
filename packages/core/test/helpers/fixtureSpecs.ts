import type { LatLon, Section } from '../../src/types';
import { arc, concat, drive, line, offset, ORIGIN, reverseXY, testCourse, toLatLon, type DriveOptions, type DriveSample } from './trace';

/**
 * A közös fixtúrák leírása (A9): a TS- és a Swift-tesztek ugyanazokból a JSON-fájlokból dolgoznak
 * (`packages/core/fixtures`). A fájlokat ez a leírás állítja elő (`npm run fixtures -w @atlagsebesseg/core`),
 * a `fixtures.test.ts` pedig ellenőrzi, hogy a lemezen lévő változat friss.
 */

const course = testCourse();
const IN = course.leadInM;
const L = course.section.lengthM;
const coursePath = toLatLon(course.fullXY);

/** A kézi mód pályája: 3 km egyenes + 2 km-es enyhe ív (R = 4000 m). */
const MANUAL_R = 4000;
const manualPath = toLatLon(
  concat(line({ x: 0, y: 0 }, { x: 0, y: 3000 }), arc({ x: MANUAL_R, y: 3000 }, MANUAL_R, Math.PI, Math.PI - 2000 / MANUAL_R)),
);

/** Egymás utáni szakaszok: a tesztpálya után közvetlenül egy 5 km-es egyenes. */
const endXY = course.sectionXY[course.sectionXY.length - 1]!;
const nextXY = line(endXY, { x: endXY.x + 5000, y: endXY.y });
const nextPts = toLatLon(nextXY);
const secondSection: Section = { ...course.section, id: 'TEST-2', start: nextPts[0]!, end: nextPts[nextPts.length - 1]!, lengthM: 5000, geometry: nextPts };

/** Geometria nélküli (egyenes) szakasz. */
const straightPts = toLatLon(line({ x: 0, y: 0 }, { x: 0, y: 6000 }));
const { geometry: _g, ...courseNoGeometry } = course.section;
const straightSection: Section = { ...courseNoGeometry, id: 'S', start: straightPts[0]!, end: straightPts[straightPts.length - 1]!, lengthM: 6000 };

export interface SectionsFixture {
  origin: LatLon;
  leadInM: number;
  course: Section;
  second: Section;
  straight: Section;
  /** Egy távoli kezdőpont (50 km keletre) a setSections-teszt „MASIK” szakaszához. */
  farStart: LatLon;
}

export const SECTIONS: SectionsFixture = {
  origin: ORIGIN,
  leadInM: IN,
  course: course.section,
  second: secondSection,
  straight: straightSection,
  farStart: toLatLon([{ x: 50_000, y: 0 }])[0]!,
};

export interface RouteFixture {
  /** A szakasz 120 m-rel jobbra eltolva, minden 10. pont (5-től). */
  parallel120: LatLon[];
  /** 1000 m egyenes észak felé, 100 m-es pontokkal. */
  line1000: LatLon[];
  /** Hajtűkanyar: fel 1000 m, majd vissza le 30 m-rel arrébb. */
  hairpin: LatLon[];
}

export const ROUTE: RouteFixture = {
  parallel120: toLatLon(offset(course.sectionXY, 120)).filter((_, i) => i % 10 === 5),
  line1000: toLatLon(line({ x: 0, y: 0 }, { x: 0, y: 1000 })),
  hairpin: toLatLon([...line({ x: 0, y: 0 }, { x: 0, y: 1000 }), ...line({ x: 30, y: 1000 }, { x: 30, y: 0 })]),
};

/** Egy vezetés leírása: a fájlnév és a `drive()` paraméterei (a függvényeket szövegesen is rögzítjük). */
export interface DriveSpec {
  name: string;
  description: string;
  options: () => DriveOptions;
}

const exitPath = toLatLon(
  concat(course.leadIn, line({ x: 0, y: 0 }, { x: 0, y: 4000 }), line({ x: 0, y: 4000 }, { x: 150, y: 4300 }), line({ x: 150, y: 4300 }, { x: 2000, y: 4400 })),
);
const consecutivePath = toLatLon(concat(course.leadIn, course.sectionXY, nextXY, line({ x: endXY.x + 5000, y: endXY.y }, { x: endXY.x + 6000, y: endXY.y })));

export const DRIVES: readonly DriveSpec[] = [
  { name: 'normal-120', description: 'tesztpálya, 120 km/h, 4 m zaj, seed 7', options: () => ({ path: coursePath, speedKmh: () => 120, noiseM: 4, seed: 7 }) },
  { name: 'clean-120', description: 'tesztpálya, 120 km/h, zaj nélkül', options: () => ({ path: coursePath, speedKmh: () => 120 }) },
  { name: 'clean-140', description: 'tesztpálya, 140 km/h, zaj nélkül', options: () => ({ path: coursePath, speedKmh: () => 140 }) },
  { name: 'clean-110', description: 'tesztpálya, 110 km/h, zaj nélkül', options: () => ({ path: coursePath, speedKmh: () => 110 }) },
  { name: 'clean-90', description: 'tesztpálya, 90 km/h, zaj nélkül', options: () => ({ path: coursePath, speedKmh: () => 90 }) },
  {
    name: 'accel-125-160',
    description: 'tesztpálya: 8 km 125 km/h, utána 160 km/h',
    options: () => ({ path: coursePath, speedKmh: (s) => (s < IN + 8000 ? 125 : 160) }),
  },
  { name: 'const-160', description: 'tesztpálya, végig 160 km/h', options: () => ({ path: coursePath, speedKmh: () => 160 }) },
  {
    name: 'split-150-100',
    description: 'tesztpálya: a szakasz feléig 150, utána 100 km/h',
    options: () => ({ path: coursePath, speedKmh: (s) => (s < IN + L / 2 ? 150 : 100) }),
  },
  {
    name: 'tunnel-120',
    description: 'tesztpálya, 120 km/h, 4 m zaj, seed 3, 2 km kiesés a kanyarban, ugrás a 200., 201. és 330. mintánál',
    options: () => ({ path: coursePath, speedKmh: () => 120, noiseM: 4, seed: 3, dropRanges: [[IN + 5000, IN + 7000]], jumpAt: [200, 201, 330] }),
  },
  {
    name: 'opposite-25m-noise3',
    description: 'ellenirányú pálya 25 m-re, 120 km/h, 3 m zaj',
    options: () => ({ path: toLatLon(offset(reverseXY(course.fullXY), 25)), speedKmh: () => 120, noiseM: 3 }),
  },
  {
    name: 'opposite-25m',
    description: 'ellenirányú pálya 25 m-re, 120 km/h, zaj nélkül',
    options: () => ({ path: toLatLon(offset(reverseXY(course.fullXY), 25)), speedKmh: () => 120 }),
  },
  {
    name: 'parallel-150m',
    description: 'párhuzamos út 150 m-re, 90 km/h, 4 m zaj',
    options: () => ({ path: toLatLon(offset(course.fullXY, 150)), speedKmh: () => 90, noiseM: 4 }),
  },
  {
    name: 'parallel-60m',
    description: 'szervizút 60 m-re, 90 km/h',
    options: () => ({ path: toLatLon(offset(course.fullXY, 60)), speedKmh: () => 90 }),
  },
  { name: 'exit-at-4km', description: 'letérés 4 km után kelet felé, 100 km/h, 3 m zaj', options: () => ({ path: exitPath, speedKmh: () => 100, noiseM: 3 }) },
  { name: 'consecutive-110', description: 'tesztpálya + 5 km-es második szakasz, 110 km/h', options: () => ({ path: consecutivePath, speedKmh: () => 110 }) },
  {
    name: 'jam-100',
    description: 'tesztpálya, 100 km/h, 2 perc állás 3 km-nél, 6 m zaj, seed 11',
    options: () => ({ path: coursePath, speedKmh: () => 100, pauses: [{ atS: IN + 3000, durationMs: 120_000 }], noiseM: 6, seed: 11 }),
  },
  {
    name: 'straight-130',
    description: 'egyenes (geometria nélküli) szakasz, 130 km/h',
    options: () => ({ path: toLatLon(line({ x: 0, y: -2500 }, { x: 0, y: 7000 })), speedKmh: () => 130 }),
  },
  ...Array.from({ length: 20 }, (_, i): DriveSpec => {
    const seed = i + 1;
    return {
      name: `robust-seed-${String(seed).padStart(2, '0')}`,
      description: `tesztpálya, 110 + 15·sin(s/700) km/h, 8 m zaj, 10 m pontosság, seed ${seed}`,
      options: () => ({ path: coursePath, speedKmh: (s) => 110 + 15 * Math.sin(s / 700), noiseM: 8, accuracy: 10, seed }),
    };
  }),
  { name: 'manual-noise3', description: 'kézi pálya, 100 km/h, 3 m zaj, seed 5', options: () => ({ path: manualPath, speedKmh: () => 100, noiseM: 3, seed: 5 }) },
  { name: 'manual-clean', description: 'kézi pálya, 100 km/h, zaj nélkül', options: () => ({ path: manualPath, speedKmh: () => 100 }) },
  { name: 'manual-tunnel', description: 'kézi pálya, 100 km/h, kiesés 1000–2500 m között', options: () => ({ path: manualPath, speedKmh: () => 100, dropRanges: [[1000, 2500]] }) },
  { name: 'manual-jumps', description: 'kézi pálya, 100 km/h, ugrás a 40. és 90. mintánál', options: () => ({ path: manualPath, speedKmh: () => 100, jumpAt: [40, 90] }) },
  {
    name: 'manual-standing',
    description: 'kézi pálya: az első 10 m-en szinte áll (0,01 km/h), 4 m zaj, seed 9',
    options: () => ({ path: manualPath, speedKmh: (s) => (s < 10 ? 0.01 : 100), noiseM: 4, seed: 9 }),
  },
];

/** Egy minta a fájlban: [lat, lon, timestamp, speed, accuracy, heading, s, dropped (0/1)]. */
export type SampleRow = [number, number, number, number | null, number | null, number | null, number, 0 | 1];

export const toRow = (x: DriveSample): SampleRow => [x.fix.lat, x.fix.lon, x.fix.timestamp, x.fix.speed, x.fix.accuracy, x.fix.heading, x.s, x.dropped ? 1 : 0];

export const fromRow = ([lat, lon, timestamp, speed, accuracy, heading, s, dropped]: SampleRow): DriveSample => ({
  fix: { lat, lon, timestamp, speed, accuracy, heading },
  s,
  t: timestamp,
  dropped: dropped === 1,
});

/** JSON soronként egy mintával (olvasható diff), a számok a JS legrövidebb, oda-vissza pontos alakjában. */
function stringifyDrive(spec: DriveSpec, samples: DriveSample[]): string {
  const rows = samples.map((x) => '    ' + JSON.stringify(toRow(x)));
  return `{\n  "name": ${JSON.stringify(spec.name)},\n  "description": ${JSON.stringify(spec.description)},\n  "samples": [\n${rows.join(',\n')}\n  ]\n}\n`;
}

/** Az összes fixtúra-fájl: relatív útvonal → tartalom. */
export function renderFixtures(): Map<string, string> {
  const out = new Map<string, string>();
  out.set('sections.json', JSON.stringify(SECTIONS, null, 2) + '\n');
  out.set('route.json', JSON.stringify(ROUTE, null, 2) + '\n');
  for (const spec of DRIVES) out.set(`drives/${spec.name}.json`, stringifyDrive(spec, drive(spec.options())));
  return out;
}
