// AW24: az invariánsok automata őrei (docs/INVARIANTS.md). `npm run invariants` – az `npm test` része; az iOS-párja: AtlagsebessegTests/InvariantsTests.swift.
// Az érték-őrök a konstansokat és a viselkedést mérik, a forrás-őrök a CSS-blokkok és fájlok ujjlenyomatát a docs/invariants.lock.json-nal vetik össze.
// A lock csak engedéllyel frissül: `npm run invariants -- --update-lock INV-xx` (CLAUDE.md: a prompt szó szerint tartalmazza az engedélyt).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { addRecent, addSavedOther, altWorth, ALT_OFFER, cameraVisibility, displayPlace, parseSaved, setSavedPlace, pendingCountryWarnings, visibleCameras, type FixedCamera, chooseLightPreset, CRUISE_SECTION_M, cruiseCard, DEFAULT_SETTINGS, DICTIONARIES, HEAT, mapLightPreset, mapTheme, MAP_LOOKS, PositionSmoother, strongGlassFor, TrackIndex, TRAFFIC, TRIP, ZONE_RADII } from '@atlagsebesseg/app-logic';
import { haversineM, meterState } from '@atlagsebesseg/core';
import { color, size } from '@atlagsebesseg/design-tokens';

const ROOT = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');
const LOCK_PATH = 'docs/invariants.lock.json';
type Lock = { colors: Record<string, string>; fingerprints: Record<string, Record<string, string>> };
const lock = JSON.parse(read(LOCK_PATH)) as Lock;

const sha = (s: string) => createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
/** A CSS-blokk tartalma szelektor szerint (a több azonos szelektorú blokk összefűzve). */
function cssBlocks(css: string, selector: string): string {
  const out: string[] = [];
  const re = /(^|\n)([^\n{}@/][^{}\n]*)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(css)); ) if (m[2]!.trim() === selector) out.push(m[3]!);
  if (out.length === 0) throw new Error(`nincs CSS-blokk: ${selector}`);
  return out.join('\n');
}

const failures: string[] = [];
const eq = (actual: unknown, want: unknown, what: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(want)) failures.push(`${what}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(want)}`);
};
const has = (text: string, needle: string | RegExp, what: string) => {
  if (!(typeof needle === 'string' ? text.includes(needle) : needle.test(text))) failures.push(`${what}: nem található: ${String(needle)}`);
};
const lacks = (text: string, needle: string | RegExp, what: string) => {
  if (typeof needle === 'string' ? text.includes(needle) : needle.test(text)) failures.push(`${what}: tiltott: ${String(needle)}`);
};
/** A sorrend a forrásban: a minták ebben a sorrendben fordulnak elő. */
const order = (text: string, needles: string[], what: string) => {
  let at = 0;
  for (const n of needles) {
    const i = text.indexOf(n, at);
    if (i < 0) failures.push(`${what}: sorrend: ${n}`);
    else at = i + n.length;
  }
};

const CSS = 'apps/web/src/styles.css';
const adapter = () => read('apps/web/src/map/MapboxWebAdapter.tsx');
const mapScreen = () => read('apps/ios/Atlagsebesseg/Map/MapScreen.swift');
const app = () => read('apps/web/src/App.tsx');
const drive = () => read('apps/ios/Atlagsebesseg/UI/DriveView.swift');

/** Az ujjlenyomattal védett források (azonosító → név → tartalom). */
const FINGERPRINTS: Record<string, Record<string, () => string>> = {
  'INV-05': {
    '.actions': () => cssBlocks(read(CSS), '.actions'),
    '.actions-upper': () => cssBlocks(read(CSS), '.actions-upper'),
    '.recenter-slot': () => cssBlocks(read(CSS), '.recenter-slot'),
  },
  'INV-19': {
    '.cruise-card': () => cssBlocks(read(CSS), '.cruise-card'),
    'CruiseCard.tsx': () => read('apps/web/src/ui/CruiseCard.tsx'),
  },
  'INV-22': {
    '.scrim-top': () => cssBlocks(read(CSS), '.scrim-top'),
    '.mapboxgl-ctrl-top-left': () => cssBlocks(read(CSS), '.mapboxgl-ctrl-top-left'),
    '.mapboxgl-ctrl-top-right': () => cssBlocks(read(CSS), '.mapboxgl-ctrl-top-right'),
    'logo-margó': () => cssBlocks(read(CSS), '.app .mapboxgl-ctrl-top-left .mapboxgl-ctrl'),
    'i-margó': () => cssBlocks(read(CSS), '.app .mapboxgl-ctrl-top-right .mapboxgl-ctrl'),
  },
  'INV-23': {
    '.app': () => cssBlocks(read(CSS), '.app'),
  },
  'INV-06': {
    'HeatSwitch.tsx': () => read('apps/web/src/ui/HeatSwitch.tsx'),
    '.heat-switch': () => cssBlocks(read(CSS), '.heat-switch'),
  },
};

const settingsSheet = () => read('apps/web/src/ui/SettingsSheet.tsx');

const CHECKS: Record<string, () => void> = {
  'INV-01': () => {
    has(adapter(), /show3dObjects:\s*true/, 'web: 3D épületek');
    lacks(adapter(), /show3dObjects:\s*false/, 'web: 3D épületek');
    has(adapter(), 'STANDARD_STYLE', 'web: Mapbox Standard');
    has(mapScreen(), /\.mapStyle\(\.standard\(/, 'iOS: Mapbox Standard');
    has(mapScreen(), /show3dObjects:\s*true/, 'iOS: 3D épületek');
    lacks(mapScreen(), /show3dObjects:\s*false/, 'iOS: 3D épületek');
  },
  'INV-02': () => {
    eq(MAP_LOOKS, ['vilagos', 'szines', 'visszafogott'], 'térképstílusok sorrendje');
    eq(DEFAULT_SETTINGS.terkep, 'szines', 'alap térképstílus');
    eq(['nappal', 'hajnal', 'alkony', 'ejszaka', null].map((p) => chooseLightPreset(p as never)), ['day', 'dawn', 'dusk', 'night', 'day'], 'napszak → fény');
    eq(MAP_LOOKS.map((l) => mapLightPreset(l, 'day')), ['day', 'dusk', 'day'], 'napközbeni fény stílusonként');
    for (const p of ['dawn', 'dusk', 'night'] as const) eq(MAP_LOOKS.map((l) => mapLightPreset(l, p)), [p, p, p], `${p}: a napszaké`);
    eq(MAP_LOOKS.map((l) => mapTheme(l)), ['default', 'default', 'monochrome'], 'téma');
    eq([strongGlassFor('vilagos', 'day'), strongGlassFor('vilagos', 'night'), strongGlassFor('szines', 'day')], [true, false, false], 'erős üveg');
  },
  'INV-03': () => {
    const s = (a: number | null, p: number | null) => meterState({ averageKmh: a, projectedKmh: p, speedLimitKmh: 130 });
    eq([s(null, 120), s(130, 200), s(131, 130), s(131, 131), s(140, null), s(100, 150)], [null, 'jo', 'lassits', 'tul_gyors', 'tul_gyors', 'jo'], 'mérőkártya-állapotok');
  },
  'INV-04': () => {
    has(read('apps/web/src/ui/Hud.tsx'), "if (view.phase === 'kezi' || view.phase === 'kezi_eredmeny') return 'kezi';", 'web: kézi tónus');
    has(read('apps/web/src/ui/Hud.tsx'), 'className="manual-mini glass" data-tone="kezi"', 'web: ManualMini tónus');
    has(read('apps/ios/Atlagsebesseg/UI/Theme.swift'), 'case .kezi, .keziEredmeny: return .kezi', 'iOS: kézi tónus');
  },
  'INV-05': () => {
    const a = app();
    const row = a.slice(a.indexOf('className="actions"'));
    order(row, ['className="actions-upper"', '<ManualMini', 'className="recenter-slot"', "setSheet('settings')", 'onClick={startManual}', "setSheet('report')"], 'web: gombsor');
  },
  'INV-06': () => {
    has(read('apps/web/src/ui/HeatSwitch.tsx'), 'heat-switch', 'web: hőtérkép-váltó');
    has(read('apps/ios/AtlagsebessegTests/ParityTests.swift'), 'ParitySpec.load("heat-switch")', 'iOS: a váltó spec-őre');
  },
  'INV-07': () => {
    for (const [k, v] of Object.entries(lock.colors)) eq((color as Record<string, string>)[k], v, `token ${k}`);
  },
  'INV-08': () => {
    const want = { hu: 'Átlagsebesség', en: 'Tempomate', de: 'Tempo Nav', sk: 'Rýchlosť Nav', cs: 'Prům. rychlost', pl: 'Prędkość Nav' } as const;
    for (const [l, v] of Object.entries(want)) eq(DICTIONARIES[l as keyof typeof want]['ios.displayName'], v, `kijelzőnév ${l}`);
    eq(DICTIONARIES.en['app.name'], 'Tempomate', 'EN cím');
    eq(DICTIONARIES.hu['app.name'], 'Átlagsebesség', 'HU cím');
    has(read('apps/ios/project.yml'), 'CFBundleDisplayName: Tempomate', 'iOS alap kijelzőnév');
  },
  'INV-09': () => {
    eq(DICTIONARIES.hu['report.note.default'], 'A jelenlegi helyed és haladási irányod kerül a bejelentésbe. Ideiglenes szakasz: a mérés végén a „Vége” gomb jelenti be a záró kaput.', 'Bejelentés lap alsó szövege');
    has(read('apps/web/src/ui/ReportSheet.tsx'), "t('report.note.default')", 'web: a lap alsó szövege');
  },
  'INV-10': () => {
    eq([HEAT.zoneDefaultM, HEAT.shareEndsM], [200, 300], 'zóna és út eleje / vége');
    eq(ZONE_RADII, [200, 500, 1000], 'választható zónák');
  },
  'INV-11': () => {
    eq([ALT_OFFER.minGainS, ALT_OFFER.worthNetMin, ALT_OFFER.slowKmh, ALT_OFFER.fastKmh, ALT_OFFER.kSlow, ALT_OFFER.kFast], [120, 2, 40, 110, 1, 0.3], 'megéri-szabály');
    eq([altWorth(240, 0, 100).verdict, altWorth(180, 2000, 40).verdict, altWorth(120, 3000, 30).verdict], ['worth', 'maybe', 'not'], 'megéri-példák');
  },
  'INV-12': () => {
    eq([TRAFFIC.jamSlowFraction, TRAFFIC.jamWindowMs, TRAFFIC.lightPatienceMs, TRAFFIC.lightNearM, TRAFFIC.jamClearFraction], [0.4, 180_000, 120_000, 60, 0.7], 'dugó-küszöbök');
    eq([TRAFFIC.jamClearCityM, TRAFFIC.jamClearCityMs, TRAFFIC.jamClearHighwayM, TRAFFIC.jamClearHighwayMs], [1000, 120_000, 3000, 180_000], 'ETA-korrekció lejárata');
    has(read('packages/app-logic/src/navigation/traffic.ts'), 'highwayAt', 'lámpa-türelem csak nem autópályán');
  },
  'INV-13': () => {
    eq([TRIP.startKmh, TRIP.startHoldS, TRIP.maxAccuracyM], [15, 30, 30], 'krúzing-küszöbök');
    has(read('packages/app-logic/test/trips.test.ts'), /navig[^\n]*(külön|lezár)/, 'a navigált út külön útjának tesztje');
  },
  'INV-14': () => {
    const trace = JSON.parse(read('packages/app-logic/src/fixtures/gps-trace-1hz.json')) as { traces: { name: string; fixes: number[][] }[] };
    const T0 = 1_800_000_000_000;
    const FRAME_MS = 1000 / 60;
    for (const tr of trace.traces) {
      const s = new PositionSmoother();
      const list = tr.fixes.map(([t, lat, lon], i) => {
        const prev = tr.fixes[i - 1];
        const d = prev ? haversineM({ lat: prev[1]!, lon: prev[2]! }, { lat: lat!, lon: lon! }) : 0;
        return { lat: lat!, lon: lon!, timestamp: T0 + t! * 1000, speed: prev && t! > prev[0]! ? d / (t! - prev[0]!) : 0, accuracy: 5, heading: null };
      });
      let i = 0;
      let last: { lat: number; lon: number } | null = null;
      for (let t = list[0]!.timestamp; t < list.at(-1)!.timestamp + 1000; t += FRAME_MS) {
        while (i < list.length && list[i]!.timestamp <= t) s.onFix(list[i++]!, t);
        const p = s.at(t);
        if (!p) continue;
        if (last && haversineM(last, p) > 2 * ((Math.max(p.speedMps, 1) * FRAME_MS) / 1000) + 1e-6) failures.push(`GPS-jelölő ugrás (${tr.name})`);
        last = { lat: p.lat, lon: p.lon };
      }
    }
    has(read('apps/ios/AtlagsebessegTests/PositionSmootherTests.swift'), 'valódi 1 Hz-es nyomat', 'iOS: folyamatosság-teszt');
  },
  'INV-15': () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    has(pkg.scripts.parity ?? '', 'packages/parity/scripts/parity.mjs', 'npm run parity');
    has(read('packages/parity/scripts/diff-core.mjs'), 'THRESHOLDS', 'a kapu küszöbei');
    for (const [ts, swift] of [['navigation.test.ts', 'NavigationTests.swift'], ['trips.test.ts', 'TripTests.swift'], ['heat.test.ts', 'HeatTests.swift'], ['account.test.ts', 'AccountTests.swift'], ['track.test.ts', 'TrackTests.swift']] as const) {
      const sw = read(`apps/ios/AtlagsebessegTests/${swift}`);
      const names = [...read(`packages/app-logic/test/${ts}`).matchAll(/\bit\('((?:[^'\\]|\\.)+)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
      const missing = names.filter((n) => !sw.includes(n));
      if (missing.length > 0) failures.push(`${ts} ↔ ${swift}: ${missing.length} teszt nincs meg azonos néven, pl. ${missing[0]}`);
    }
  },
  'INV-16': () => {
    has(adapter(), "new mapboxgl.AttributionControl({ compact: true, customAttribution: t('map.attribution') })", 'web: attribúció');
    has(adapter(), "logoPosition: 'top-left'", 'web: logó');
    lacks(read(CSS), /mapboxgl-ctrl-(logo|attrib)[^{]*\{[^}]*display:\s*none/, 'web: az attribúció nem rejthető');
    has(mapScreen(), /attributionButton: AttributionButtonOptions\(position: \.topTrailing/, 'iOS: attribúció');
    has(mapScreen(), /logo: LogoViewOptions\(position: \.topLeading/, 'iOS: logó');
    has(read('apps/ios/Atlagsebesseg/LiveActivity/LiveMap.swift'), 'attribution=false', 'a térképkép attribúciója a nézetben');
    has(DICTIONARIES.hu['ios.live.attribution'], 'Mapbox', 'Live Activity attribúció');
  },
  'INV-17': () => {
    has(read('apps/ios/Atlagsebesseg/App/AppModel.swift'), /func launchSimSpeed[^}]*#if DEBUG[^#]*#else\s*return 4\s*#endif/, 'iOS: -simSpeed csak DEBUG');
    has(read('apps/web/src/sim/useSimulator.ts'), 'import.meta.env.DEV ? SIM_SPEEDS.find', 'web: ?speed csak dev');
    lacks(read('apps/ios/scripts/testflight.sh'), /-configuration Debug/, 'TestFlight: Release');
  },
  'INV-18': () => {
    const a = adapter();
    has(a, 'const ROUTE_W = size.routeLine;', 'web: az útvonal-vonal tokenje');
    eq(size.routeLine, 7, 'az útvonal-vonal vastagsága');
    has(a, /id: 'heat',\s*type: 'line'/, 'web: vonal-réteg');
    has(a, /id: 'heat-grey',\s*type: 'line'/, 'web: szürke vonal-réteg');
    lacks(a, "type: 'heatmap'", 'web: nincs heatmap-réteg');
    has(a, /'line-color': heatColor\('gyakorisag'\), 'line-width': ROUTE_W/, 'web: a csík vastagsága');
    const m = mapScreen();
    has(m, 'private static let routeW = Double(Tokens.Size.routeLine)', 'iOS: az útvonal-vonal tokenje');
    has(m, 'LineLayer(id: "heat-layer", source: "heat")', 'iOS: vonal-réteg');
    lacks(m, 'HeatmapLayer', 'iOS: nincs heatmap-réteg');
    const i = new TrackIndex();
    i.add([{ matched: true, coords: Array.from({ length: 61 }, (_, k) => [47.5 + (k * 25) / 111_195, 19] as [number, number]), kmh: new Array<number>(61).fill(50) }]);
    const one = i.lines({ zoom: 15, bbox: { south: 47.49, north: 47.52, west: 18.99, east: 19.01 } }, 'gyakorisag', []).filter((l) => !l.grey);
    eq(one.length, 1, 'egy áthaladás egy látható vonal');
  },
  'INV-19': () => {
    const v = { distanceM: 12_400, elapsedS: 1380, dirChanges: 3 };
    eq(color.cruiseCard, '#1B78BA', 'a kártya színe');
    eq(color.cruiseCardText, '#FFFFFF', 'a kártya szövege');
    eq(CRUISE_SECTION_M, 5000, 'a szakasz látótávolsága');
    eq(cruiseCard({ cruise: v, active: true, collapsed: false, sectionAheadM: 3200, unit: 'kmh' }).kind, 'full', 'mozgásban teljes');
    eq(cruiseCard({ cruise: null, active: true, collapsed: false, sectionAheadM: null, unit: 'kmh' }).kind, 'ready', 'állva kész');
    eq(cruiseCard({ cruise: v, active: true, collapsed: true, sectionAheadM: null, unit: 'kmh' }).kind, 'strip', 'kártya mellett sáv');
    eq(cruiseCard({ cruise: v, active: false, collapsed: false, sectionAheadM: null, unit: 'kmh' }).kind, 'hidden', 'navigáció alatt nincs');
    const css = cssBlocks(read(CSS), '.cruise-card');
    const nav = cssBlocks(read(CSS), '.nav-top');
    // AW24 (INV-19 módosítva, Kristof engedélyével): a kártya a kerek kereső-gomb ALATT kezdődik, a manőver-kártya marad a + 84-en
    has(css, 'top: calc(env(safe-area-inset-top) + 40px + var(--size-round-button) + 8px);', 'krúzing-kártya: a kereső-gomb alatt');
    has(nav, 'top: calc(env(safe-area-inset-top) + 84px);', 'manőver-kártya');
    for (const decl of ['left: max(12px, env(safe-area-inset-left));', 'right: max(12px, env(safe-area-inset-right));', 'border-radius: 28px;', 'padding: 14px 18px;']) {
      has(css, decl, 'krúzing-kártya');
      has(nav, decl, 'manőver-kártya');
    }
  },
  'INV-20': () => {
    order(settingsSheet(), ['<AccountCard', "t('settings.group.display')", "t('settings.group.privacy')", "t('settings.share')", '<BackupRow', '<DeleteAccountRow', "t('settings.attribution')", '<SignOutRow'], 'web: Beállítások');
    order(read('apps/ios/Atlagsebesseg/UI/SettingsSheet.swift'), ['AccountCard(model: model)', '.settingsGroupDisplay', '.settingsGroupPrivacy', 'privacyCard', '.settingsAttribution', 'SignOutRow(model: model)'], 'iOS: Beállítások');
    order(read('apps/web/src/ui/AccountCard.tsx'), ['<Avatar', 'account-profile-name', 'account-profile-email', '<NameRow'], 'web: fiók-kártya');
    lacks(read('apps/web/src/ui/AccountCard.tsx').slice(0, read('apps/web/src/ui/AccountCard.tsx').indexOf('const notConfigured')), 'syncStatusText', 'web: nincs szinkron-sor');
    order(read('apps/ios/Atlagsebesseg/UI/AccountViews.swift'), ['AvatarButton(model: model', 'Text(name)', 'Text(e)'], 'iOS: fiók-kártya');
    has(read('apps/web/src/ui/AccountCard.tsx'), 'className="mini-btn wide danger"', 'web: a fiók törlése piros');
  },
  'INV-22': () => {
    const theme = read('apps/ios/Atlagsebesseg/UI/Theme.swift');
    has(theme, 'static let logo = CGRect(x: 8, y: 4, width: 85, height: 21)', 'iOS: a logó helye');
    has(theme, 'static let infoCenterFromTrailing: CGFloat = 20', 'iOS: az „i” vízszintes helye');
    has(theme, 'static let infoCenterY: CGFloat = 16', 'iOS: az „i” függőleges helye');
    has(theme, '.frame(height: top + 140)', 'iOS: a sötétítés magassága');
    has(theme, '.blendMode(.destinationOut)', 'iOS: a sötétítés kihagyja a logót és az „i”-t');
    has(theme, 'WebInfoBadge()', 'iOS: az „i” a webes rajzzal');
    has(mapScreen(), '.ornamentOptions(.web)', 'iOS: a térkép ornamentjei');
    has(read('apps/ios/Atlagsebesseg/UI/StartView.swift'), '.ornamentOptions(.web)', 'iOS: a kezdőképernyő ornamentjei');
    has(read('packages/parity/scripts/webkit-layout.mjs'), "a Mapbox-logó helye", 'WebKit-mérés');
  },
  'INV-23': () => {
    has(read('apps/web/src/sw/standalone.ts'), "setProperty('--app-h', `${window.innerHeight}px`)", 'web: az app magassága a látható nézetablak');
    lacks(read('apps/web/src/sw/standalone.ts'), 'screen.height', 'web: nem a kijelző magassága');
    has(read('apps/web/src/main.tsx'), 'trackAppHeight()', 'web: a magasság követése');
    has(read('packages/parity/scripts/webkit-layout.mjs'), "'kezdokepernyo-rovid'", 'WebKit-mérés: a rövidebb kezdőképernyős indítás');
    has(read('package.json'), '"webkit:layout"', 'WebKit-mérés parancsa');
  },
  'INV-21': () => {
    eq(DEFAULT_SETTINGS.felho_mentes, true, 'a felhős mentés alapja');
    has(read('apps/ios/Atlagsebesseg/Logic/Settings.swift'), 'var felhoMentes = true', 'iOS: a felhős mentés alapja');
  },
  'INV-25': () => {
    const hit = { id: 'mbx1', name: 'IKEA Budaörs', address: 'Budaörs, Magyarország', lat: 47.4613, lon: 18.9601, routable: { lat: 47.4611, lon: 18.9603 } };
    const saved = addSavedOther(setSavedPlace({ home: null, work: null, others: [] }, 'work', hit), { ...hit, id: 'o', lat: 47.6, label: 'Edzőterem' });
    const stored = JSON.stringify({ saved, recents: addRecent([], hit) });
    eq(['IKEA', 'Budaörs'].filter((w) => stored.includes(w)), [], 'a tárolt alakban nincs Mapbox-név / -cím');
    eq(parseSaved(stored.slice(9, stored.indexOf(',"recents"'))).others[0]?.label, 'Edzőterem', 'a saját címke tárolódik');
    eq(displayPlace(saved.work!).name, 'IKEA Budaörs', 'megjelenítéskor a futás alatti név');
    has(read('apps/web/src/nav/useNavigation.ts'), 'setSavedPlace(prev, kind, place)', 'web: Haza / Munka a tisztító úton');
    has(read('apps/ios/Atlagsebesseg/Navigation/Geocoding.swift'), 'let sp = storedPlace(p)', 'iOS: a tárolt JSON tisztított');
    has(read('apps/ios/Atlagsebesseg/App/AppModel+Navigation.swift'), 'setSavedPlace($0, .home, place)', 'iOS: Haza a tisztító úton');
  },
  'INV-24': () => {
    const rules = JSON.parse(read('packages/data/camera_visibility.json')) as { default: string; countries: Record<string, { mode: string; warning?: string }> };
    eq(rules.default, 'show', 'alap: show');
    eq(Object.fromEntries(Object.entries(rules.countries).filter(([, v]) => v.mode !== 'show' || v.warning)), { FR: { mode: 'zone' }, DE: { mode: 'show', warning: 'warn.camera.DE' }, CH: { mode: 'hide' } }, 'a nem alapértelmezett országok');
    eq(['DE', 'FR', 'CH', 'HU', 'SK'].map(cameraVisibility), ['show', 'zone', 'hide', 'show', 'show'], 'cameraVisibility');
    eq(pendingCountryWarnings(['DE', 'FR', 'CH', 'HU'], () => false).map((w) => w.country), ['DE'], 'csak DE figyelmeztet');
    eq(pendingCountryWarnings(['DE'], () => true), [], 'egyszer');
    const cam = (country: string): FixedCamera => ({ id: country, country, type: 'speed', lat: 48.85123, lon: 2.35123, headingDeg: null, road: '', speedLimitKmh: null, source: '', sourceUrl: '', sourceDate: '', verified: false });
    const v = visibleCameras([cam('FR'), cam('CH'), cam('DE')]);
    eq(v.points.map((c) => c.country), ['DE'], 'pontként csak DE');
    eq(v.zones.length === 1 && v.zones[0]!.radiusM === 1000 && v.zones[0]!.center.lat !== 48.85123 && v.zones[0]!.label === DICTIONARIES.hu['camera.zone'], true, 'FR: kerekített 1 km-es zóna felirattal');
    eq(DICTIONARIES.hu['camera.zone'], 'Ellenőrzési zóna', 'a zóna felirata');
    has(read('packages/app-logic/src/navigation/enforcement.ts'), "cameraVisibility(c.country) !== 'show'", 'útvonal-kamera csak show');
    has(read('apps/ios/Atlagsebesseg/Logic/Alerts.swift'), 'rules.visibility(c.country) == .show', 'iOS: kamera-jelzés csak show');
    has(read('apps/ios/Atlagsebesseg/Navigation/Enforcement.swift'), 'rules.visibility(c.country) == .show', 'iOS: útvonal-kamera csak show');
    has(read('apps/web/src/map/MapboxWebAdapter.tsx'), 'camera-zone-label', 'web: zóna-felirat');
    has(read('apps/ios/Atlagsebesseg/Map/MapScreen.swift'), 'CameraZoneLabel(text: z.label)', 'iOS: zóna-felirat');
  },
};

function fingerprints(id: string): Record<string, string> {
  return Object.fromEntries(Object.entries(FINGERPRINTS[id] ?? {}).map(([k, f]) => [k, sha(f())]));
}

const updateAt = process.argv.indexOf('--update-lock');
if (updateAt >= 0) {
  const ids = process.argv.slice(updateAt + 1);
  if (ids.length === 0) throw new Error('--update-lock INV-xx …');
  for (const id of ids) {
    if (id === 'INV-07') lock.colors = { ...color };
    else lock.fingerprints[id] = fingerprints(id);
  }
  writeFileSync(new URL(LOCK_PATH, ROOT), `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`lock frissítve: ${ids.join(', ')}`);
}

const doc = read('docs/INVARIANTS.md');
const docIds = [...new Set([...doc.matchAll(/^\| (INV-\d+) \|/gm)].map((m) => m[1]!))];
const ids = Object.keys(CHECKS);
const swiftIds = [...new Set([...read('apps/ios/AtlagsebessegTests/InvariantsTests.swift').matchAll(/INV-\d+/g)].map((m) => m[0]))];
let green = 0;
const bad: string[] = [];
for (const id of ids) {
  failures.length = 0;
  try {
    CHECKS[id]!();
    for (const [k, v] of Object.entries(fingerprints(id))) eq(v, lock.fingerprints[id]?.[k], `ujjlenyomat ${k}`);
  } catch (e) {
    failures.push(String(e));
  }
  if (!doc.includes(`| ${id} |`)) failures.push('nincs a docs/INVARIANTS.md-ben');
  if (!swiftIds.includes(id)) failures.push('nincs az InvariantsTests.swift-ben');
  if (failures.length === 0) green++;
  else bad.push(...failures.map((f) => `${id} ${f}`));
}
for (const id of docIds) if (!ids.includes(id)) bad.push(`${id}: a dokumentumban van, őre nincs`);
for (const b of bad) console.error(`HIBA ${b}`);
console.log(`Invariánsok: ${green}/${docIds.length} zöld`);
process.exit(bad.length === 0 && green === docIds.length ? 0 : 1);
