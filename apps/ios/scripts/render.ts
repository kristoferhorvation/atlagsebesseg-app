import { DICTIONARIES, LANGUAGES, PLANNED_MATCH_M, PLANNED_OFF_FIXES, ROUTE_MATCH_M, type FixedCamera, type PlannedCheck, type TKey } from '@atlagsebesseg/app-logic';
import { Route, type LatLon } from '@atlagsebesseg/core';
import { testCourse } from '@atlagsebesseg/core/test/helpers/trace';
import { toSwift } from '@atlagsebesseg/design-tokens';
import { PATHS } from '../../web/src/ui/Icon';
import { buildNavSim } from '../../web/src/sim/navSim';
import { iconsSwift } from './icons';
import { buildSimulation, simCameras, simPlannedChecks, type SimScenario } from '../../web/src/sim/scenarios';

/**
 * Az iOS-app generált fájljai (A9) – egyetlen forrásból, mint a web:
 * - `Generated/DesignTokens.swift` a packages/design-tokens-ből,
 * - `Resources/Localizable.xcstrings` és `Generated/L10nKey.swift` a 6 nyelvű szótárból,
 * - `Resources/InfoPlist.xcstrings` (helyhozzáférés-szöveg, app-név) ugyanonnan,
 * - `Generated/Icons.swift` a webes Icon.tsx vonalikonjaiból,
 * - `Generated/AppLogicConstants.swift` az app-logic közös konstansaiból (A10: a tervezett mérés tűrése),
 * - `Resources/Sim/*.json` a webes szimulátor vezetéseiből (`/?sim` és `/?navsim`).
 * A kulcs → fájl térkép az `apps/ios`-hoz relatív.
 */
export function renderAll(): Map<string, string> {
  const out = new Map<string, string>();
  out.set('Atlagsebesseg/Generated/DesignTokens.swift', toSwift());
  out.set('Atlagsebesseg/Resources/Localizable.xcstrings', xcstrings(Object.keys(DICTIONARIES.hu) as TKey[], (k) => k));
  out.set(
    'Atlagsebesseg/Resources/InfoPlist.xcstrings',
    xcstrings(['app.name', 'ios.locationUsage'], (k) => ({ 'app.name': 'CFBundleDisplayName', 'ios.locationUsage': 'NSLocationWhenInUseUsageDescription' })[k as string]!),
  );
  out.set('Atlagsebesseg/Generated/L10nKey.swift', l10nKeys());
  // a webes Icon.tsx szerint a `play` és a `stop` kitöltött
  out.set('Atlagsebesseg/Generated/Icons.swift', iconsSwift(PATHS, ['play', 'stop']));
  out.set('Atlagsebesseg/Generated/AppLogicConstants.swift', appLogicConstants());
  for (const [name, content] of simFixtures()) out.set(`Atlagsebesseg/Resources/Sim/${name}`, content);
  return out;
}

/** A webbel közös app-logic konstansok – egy forrás, hogy a két platform ne térjen el. */
function appLogicConstants(): string {
  const num = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x));
  return [
    '// GENERÁLT FÁJL – kézzel ne szerkeszd.',
    '// Forrás: packages/app-logic/src/plannedChecks.ts, navigation/config.ts; újragenerálás: npm run generate -w @atlagsebesseg/ios',
    '',
    '/// A tervezett mérés vonalának tűrése (m): ennyi méteren belül számít a pozíció a vonalon lévőnek.',
    `nonisolated let PLANNED_MATCH_M = ${num(PLANNED_MATCH_M)}`,
    '/// Ennyi egymás utáni, vonalon kívüli fix után tűnik el a sáv (egy kiugró GPS-pont nem tünteti el).',
    `nonisolated let PLANNED_OFF_FIXES = ${PLANNED_OFF_FIXES}`,
    '/// A navigációs útvonal-elemzés tűrése (m): ennyire közel lévő szakasz / kamera / tervezett mérés kerül az útvonalra.',
    '/// Nem azonos a tervezett mérés sávjának tűrésével (PLANNED_MATCH_M).',
    `nonisolated let ROUTE_MATCH_M = ${num(ROUTE_MATCH_M)}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// String Catalog
// ---------------------------------------------------------------------------

/** Az Xcode saját JSON-alakja (`"kulcs" : érték`, 2 szóközös behúzás, rendezett kulcsok) – így az Xcode nem írja át. */
function xcodeJson(v: unknown, indent = ''): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = indent + '  ';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => inner + xcodeJson(x, inner)).join(',\n')}\n${indent}]` : '[]';
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length ? `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)} : ${xcodeJson(x, inner)}`).join(',\n')}\n${indent}}` : '{}';
}

/** String Catalog a szótár kulcsaiból, mind a 6 nyelvvel; a forrásnyelv az angol (nem támogatott rendszernyelvnél ez jön, mint a weben). */
function xcstrings(keys: readonly TKey[], catalogKey: (k: TKey) => string): string {
  const strings: Record<string, unknown> = {};
  for (const k of keys) {
    const localizations: Record<string, unknown> = {};
    for (const lang of LANGUAGES) localizations[lang] = { stringUnit: { state: 'translated', value: DICTIONARIES[lang][k] } };
    strings[catalogKey(k)] = { extractionState: 'manual', localizations };
  }
  return xcodeJson({ sourceLanguage: 'en', strings, version: '1.0' }) + '\n';
}

/** `hud.manual.stopTemp` → `hudManualStopTemp`, `camera.type.red_light` → `cameraTypeRedLight`. */
export function swiftCase(key: string): string {
  const parts = key.split(/[._-]/).filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p : p[0]!.toUpperCase() + p.slice(1))).join('');
}

function l10nKeys(): string {
  const keys = Object.keys(DICTIONARIES.hu);
  const seen = new Map<string, string>();
  const lines = keys.map((k) => {
    const c = swiftCase(k);
    if (seen.has(c)) throw new Error(`Swift-névütközés: ${k} ↔ ${seen.get(c)}`);
    seen.set(c, k);
    return `    case ${c} = ${JSON.stringify(k)}`;
  });
  return [
    '// GENERÁLT FÁJL – kézzel ne szerkeszd.',
    '// Forrás: packages/app-logic/src/i18n/hu.json; újragenerálás: npm run generate -w @atlagsebesseg/ios',
    '',
    '/// A szótár kulcsai – a feliratokat `t(.kulcs)`-csal kérjük (Localizable.xcstrings).',
    'enum L10nKey: String, CaseIterable, Sendable {',
    ...lines,
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Szimulátor-fixtúrák
// ---------------------------------------------------------------------------

type Row = [number, number, number, number | null, number | null, number | null, number, 0 | 1];
interface Sample {
  fix: { lat: number; lon: number; timestamp: number; speed: number | null; accuracy: number | null; heading: number | null };
  s: number;
  dropped: boolean;
}
const row = (x: Sample): Row => [x.fix.lat, x.fix.lon, x.fix.timestamp, x.fix.speed, x.fix.accuracy, x.fix.heading, x.s, x.dropped ? 1 : 0];

function simFile(meta: Record<string, unknown>, samples: readonly Sample[]): string {
  const head = Object.entries(meta).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${head.join(',\n')},\n  "samples": [\n${samples.map((x) => '    ' + JSON.stringify(row(x))).join(',\n')}\n  ]\n}\n`;
}

const cameraRow = (c: FixedCamera) => ({
  id: c.id, country: c.country, type: c.type, lat: c.lat, lng: c.lon, heading: c.headingDeg, road: c.road, speed_limit_kmh: c.speedLimitKmh,
  source: c.source, source_url: c.sourceUrl, source_date: c.sourceDate, verified: c.verified,
});

/** Az érvényesség a lejátszás kezdetéhez képest: előző nap 00:00-tól hat napig (az app a lejátszás idejéhez tolja). */
const SIM_VALID_FROM_MS = -86_400_000;
const SIM_VALID_TO_MS = 6 * 86_400_000;

/** Tervezett mérés a `planned_checks` sor alakjában (GeoJSON, lon-lat), az időpontok a lejátszás kezdetéhez képest (ms). */
const plannedRow = (c: PlannedCheck) => ({
  id: c.id,
  country: c.country,
  county: c.county,
  settlement: c.settlement,
  road_ref: c.roadRef,
  description: c.description,
  geometry:
    c.zones.length > 0
      ? { type: 'MultiPolygon', coordinates: c.zones.map((poly) => poly.map((ring) => ring.map((p) => [p.lon, p.lat]))) }
      : { type: 'MultiLineString', coordinates: c.lines.map((l) => l.map((p) => [p.lon, p.lat])) },
  speed_limit_kmh: c.speedLimitKmh,
  limit_source: c.limitSource,
  valid_from_offset_ms: SIM_VALID_FROM_MS,
  valid_to_offset_ms: SIM_VALID_TO_MS,
  time_window: c.timeWindow,
  source_url: c.sourceUrl,
});

/**
 * A webes `/?sim` forgatókönyvei a tesztpályán (t0 = 0; az app a lejátszás kezdetéhez tolja), és a `/?navsim` vezetése.
 * A10: a `tervezett` (tervezett mérés + kamerák) és a `zona` forgatókönyv is, a navsim-be pedig egy tervezett mérés kerül
 * az érkezés előtti szakaszra – így a kamera-elhaladás, a szakaszkapu-jelzés és a tervezett-mérés sáv is lejátszható.
 */
function simFixtures(): [string, string][] {
  const section = testCourse().section;
  const route = { id: section.id, label: 'Tesztpálya', section };
  const SCENARIOS: { id: SimScenario; label: string }[] = [
    { id: 'jo', label: 'Jó ütem' },
    { id: 'tul', label: 'Túl gyors' },
    { id: 'lassit', label: 'Gyors, majd lassít' },
    { id: 'alagut', label: 'Alagút' },
    { id: 'tervezett', label: 'Tervezett mérés + kamerák' },
    { id: 'zona', label: 'Települészóna' },
  ];
  const files: [string, string][] = SCENARIOS.map(({ id, label }) => {
    const sim = buildSimulation(route, id, 0);
    return [
      `sim-${id}.json`,
      simFile(
        { id, label, leadInM: sim.leadInM, sections: [sim.section], cameras: simCameras(sim, id).map(cameraRow), planned: simPlannedChecks(sim, id).map(plannedRow) },
        sim.samples,
      ),
    ];
  });
  const nav = buildNavSim(0);
  // tervezett mérés a 3. ablakban (érkezés Győrbe): a cél előtt 2400 → 1000 m-ig, a fixtúra útvonalán
  const main = new Route(nav.main.points, nav.main.distanceM);
  const D = nav.main.distanceM;
  const line: LatLon[] = [];
  for (let s = D - 2400; s < D - 1000; s += 100) line.push(main.pointAt(s));
  line.push(main.pointAt(D - 1000));
  const navPlanned: PlannedCheck = {
    id: 'sim-nav-planned',
    country: 'HU',
    county: 'Győr-Moson-Sopron',
    settlement: 'Győr',
    roadRef: '1',
    description: 'Szimulált tervezett mérés (Győr, 1-es főút)',
    lines: [line],
    zones: [],
    speedLimitKmh: 70,
    limitSource: 'osm',
    validFrom: 0,
    validTo: 0,
    timeWindow: null,
    sourceUrl: 'https://www.police.hu/',
  };
  files.push([
    'navsim-budapest-gyor.json',
    simFile(
      { id: 'navsim', label: 'Budapest → Győr (M1)', leadInM: 0, sections: [nav.section], cameras: [cameraRow(nav.camera)], planned: [plannedRow(navPlanned)] },
      nav.samples,
    ),
  ]);
  return files;
}
