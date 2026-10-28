import { DICTIONARIES, LANGUAGES, type TKey } from '@atlagsebesseg/app-logic';
import { testCourse } from '@atlagsebesseg/core/test/helpers/trace';
import { toSwift } from '@atlagsebesseg/design-tokens';
import { PATHS } from '../../web/src/ui/Icon';
import { buildNavSim } from '../../web/src/sim/navSim';
import { iconsSwift } from './icons';
import { buildSimulation, type SimScenario } from '../../web/src/sim/scenarios';

/**
 * Az iOS-app generált fájljai (A9) – egyetlen forrásból, mint a web:
 * - `Generated/DesignTokens.swift` a packages/design-tokens-ből,
 * - `Resources/Localizable.xcstrings` és `Generated/L10nKey.swift` a 6 nyelvű szótárból,
 * - `Resources/InfoPlist.xcstrings` (helyhozzáférés-szöveg, app-név) ugyanonnan,
 * - `Generated/Icons.swift` a webes Icon.tsx vonalikonjaiból,
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
  for (const [name, content] of simFixtures()) out.set(`Atlagsebesseg/Resources/Sim/${name}`, content);
  return out;
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

/** A webes `/?sim` forgatókönyvei a tesztpályán (t0 = 0; az app a lejátszás kezdetéhez tolja), és a `/?navsim` vezetése. */
function simFixtures(): [string, string][] {
  const section = testCourse().section;
  const route = { id: section.id, label: 'Tesztpálya', section };
  const SCENARIOS: { id: SimScenario; label: string }[] = [
    { id: 'jo', label: 'Jó ütem' },
    { id: 'tul', label: 'Túl gyors' },
    { id: 'lassit', label: 'Gyors, majd lassít' },
    { id: 'alagut', label: 'Alagút' },
  ];
  const files: [string, string][] = SCENARIOS.map(({ id, label }) => {
    const sim = buildSimulation(route, id, 0);
    return [`sim-${id}.json`, simFile({ id, label, leadInM: sim.leadInM, sections: [sim.section], cameras: [] }, sim.samples)];
  });
  const nav = buildNavSim(0);
  const camera = nav.camera;
  files.push([
    'navsim-budapest-gyor.json',
    simFile(
      {
        id: 'navsim',
        label: 'Budapest → Győr (M1)',
        leadInM: 0,
        sections: [nav.section],
        cameras: [
          {
            id: camera.id, country: camera.country, type: camera.type, lat: camera.lat, lng: camera.lon, heading: camera.headingDeg,
            road: camera.road, speed_limit_kmh: camera.speedLimitKmh, source: camera.source, source_url: camera.sourceUrl,
            source_date: camera.sourceDate, verified: camera.verified,
          },
        ],
      },
      nav.samples,
    ),
  ]);
  return files;
}
