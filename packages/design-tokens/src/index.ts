/**
 * Dizájn-tokenek – az egyetlen forrás (lásd DESIGN.md). Csak egyszerű értékek (szín-sztring,
 * szám px-ben / ms-ben), hogy React Native is közvetlenül használhassa.
 */

export const color = {
  bg: '#06070A',
  surface: 'rgba(14,16,22,0.72)',
  surfaceStrong: 'rgba(22,25,32,0.88)',
  surfaceRaised: 'rgba(255,255,255,0.06)',
  stroke: 'rgba(255,255,255,0.08)',
  strokeStrong: 'rgba(255,255,255,0.16)',
  text: '#F4F6FA',
  textMuted: 'rgba(244,246,250,0.64)',
  textFaint: 'rgba(244,246,250,0.40)',
  /** AOS17: a jelölőszín – kapcsoló, jelölőnégyzet, kiválasztott útvonal, fókusz. */
  accent: '#2EE59D',
  /** AW24: a krúzing-kártya égkék háttere (a `route` kékjéből világosítva, fehér szöveggel 4,7:1), mindhárom térképstíluson tömör. */
  cruiseCard: '#1B78BA',
  cruiseCardText: '#FFFFFF',
  /** AOS17: a kézi mód, a márka és a térképi elemek eddigi színe (Kristof döntése: ezek nem zöldek). */
  brand: '#7A86FF',
  ok: '#2EE59D',
  near: '#FFB224',
  over: '#FF4D61',
  idle: '#8C93A3',
  /** Tervezett rendőrségi mérés: halvány sárga vonal és sáv (A7) – nem státuszszín. */
  planned: '#F2DC82',
  /** Navigáció (A8d): a kiválasztott útvonal erős kékje és fehér kontúrja. */
  route: '#1F5BFF',
  routeCasing: '#FFFFFF',
  /**
   * Az alternatív útvonal, tömör: nappal (hajnal is) `route` 55% + a térkép háttere 45%, sötét kontúrral; éjjel
   * (alkony is) `route` 70% + háttér 30%, világos (`mapBgDay` 60%) kontúrral, hogy a sötét térképen is kiváljon.
   */
  routeAltDay: '#799CF8',
  routeAltNight: '#1E49C1',
  routeAltCasingDay: '#1A2130',
  routeAltCasingNight: 'rgba(232,235,239,0.6)',
  /** A Mapbox Standard térkép jellemző háttere (a keverékhez és a kontraszt-teszthez). */
  mapBgDay: '#E8EBEF',
  mapBgNight: '#1B2030',
  /**
   * AW20: hőtérkép-színskála. Gyakoriság: indigó → lila → borostyánsárga (ritkán → gyakran); átlagsebesség: zöld → borostyán →
   * piros (lassú → gyors). Az út színezése a napló-részleten ugyanezt a zöld–sárga–piros skálát használja (`tripSlow` /
   * `tripMid` / `tripFast`, a státuszszínekkel azonos értékek, hogy külön lehessen hangolni).
   */
  heatFreqLow: '#5B6CFF',
  heatFreqMid: '#C65CFF',
  heatFreqHigh: '#FFD166',
  heatSpeedLow: '#2EE59D',
  heatSpeedMid: '#FFB224',
  heatSpeedHigh: '#FF4D61',
  /** AW20-javítás: az adatvédelmi zónában lévő cellák a saját hőtérképen – szürke, nem színezve. */
  heatGrey: 'rgba(140,147,163,0.55)',
  tripSlow: '#2EE59D',
  tripMid: '#FFB224',
  tripFast: '#FF4D61',
  /** AW22: az Apple-gomb a hivatalos fehér stílusban; a Google „G” jelének négy színe. Más célra nem használhatók. */
  appleButton: '#FFFFFF',
  appleButtonText: '#000000',
  googleBlue: '#4285F4',
  googleGreen: '#34A853',
  googleYellow: '#FBBC05',
  googleRed: '#EA4335',
  signRing: '#E5303F',
  signFace: '#FFFFFF',
  signText: '#0B0C10',
  /** AOS18: a webes `rgba(255,255,255,x)` kitöltések (szegmens tok, kis gomb, gomb) és a pill / lap háttere. */
  fill08: 'rgba(255,255,255,0.08)',
  fill09: 'rgba(255,255,255,0.09)',
  fill10: 'rgba(255,255,255,0.10)',
  pillSurface: 'rgba(16,18,24,0.6)',
  sheetBackdrop: 'rgba(0,0,0,0.45)',
  /** AOS18: a paritás-kapu képein a térkép helyén álló egyszínű háttér (`npm run parity`, csak képkészítéshez). */
  parityBackdrop: '#4A5568',
} as const;

export type ColorToken = keyof typeof color;

/** Státusz → szín (a nagy szám, a progress és az aktív szakasz vonala). */
export const statusColor = {
  jo: color.ok,
  lassits: color.near,
  tul_gyors: color.over,
  hataron: color.near,
  tul: color.over,
  semleges: color.idle,
  kezi: color.brand,
} as const;

export type StatusTone = keyof typeof statusColor;

export const font = {
  family: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
  /** Natív appban a betöltött Inter-változat családneve (InterVariable.ttf: súly 100–900, optikai méret 14–32). */
  nativeFamily: 'Inter Variable',
} as const;

export interface TypeStyle {
  size: number;
  weight: number;
  lineHeight: number;
  /** em-ben */
  tracking: number;
}

export const type = {
  /** Az átlag; a web clamp()-pel skálázza (min … max), a natív a képernyőszélességből. */
  hero: { size: 196, weight: 680, lineHeight: 0.9, tracking: -0.045 },
  heroMin: 120,
  heroVw: 42,
  display: { size: 64, weight: 650, lineHeight: 1, tracking: -0.03 },
  title: { size: 28, weight: 620, lineHeight: 1.15, tracking: -0.015 },
  body: { size: 20, weight: 500, lineHeight: 1.3, tracking: -0.005 },
  caption: { size: 15, weight: 500, lineHeight: 1.35, tracking: 0 },
} as const satisfies Record<string, TypeStyle | number>;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

export const radius = { button: 14, tile: 22, card: 32, pill: 999 } as const;

/**
 * AOS18: az iOS literál-tilalmához (AppTests-őr): a webes `styles.css` méretei tokenként. A `f20` = 20 px; a típus-lépcső (`type`) a szerep, ez a skála.
 * Új méret csak ide kerülhet; a web a saját CSS-ét megtartja, a paritás-kapu veti össze a kettőt.
 */
export const fontSize = { f8: 8, f12: 12, f13: 13, f14: 14, f15: 15, f16: 16, f17: 17, f18: 18, f19: 19, f20: 20, f22: 22, f23: 23, f24: 24, f26: 26, f28: 28, f30: 30, f32: 32, f34: 34, f36: 36, f38: 38, f40: 40, f44: 44, f46: 46, f50: 50, f64: 64 } as const;

export const fontWeight = { w400: 400, w500: 500, w520: 520, w540: 540, w560: 560, w580: 580, w600: 600, w620: 620, w640: 640, w650: 650, w680: 680, w700: 700, w720: 720, w760: 760 } as const;

/** AOS18: a komponensek saját sarkai (`styles.css`); a `radius` a szerepek. */
export const radiusScale = { r3: 3, r8: 8, r9: 9, r10: 10, r12: 12, r14: 14, r16: 16, r18: 18, r20: 20, r22: 22, r24: 24, r26: 26, r28: 28, r999: 999 } as const;

/** AOS18: az átlátszóságok skálája (`o45` = 45%). */
export const opacity = { o09: 0.09, o10: 0.1, o12: 0.12, o14: 0.14, o16: 0.16, o17: 0.17, o18: 0.18, o22: 0.22, o24: 0.24, o25: 0.25, o28: 0.28, o35: 0.35, o40: 0.4, o45: 0.45, o50: 0.5, o55: 0.55, o60: 0.6, o70: 0.7, o72: 0.72, o78: 0.78, o85: 0.85, o90: 0.9, o92: 0.92, o94: 0.94 } as const;

/** AOS18: a tónus-színű fények CSS-elmosása (px): `text-shadow` a nagy számon, a progress kitöltése, a pill pontja, a bejelentés-jelölő. */
export const glow = { hero: 40, progress: 18, dot: 10, reportPin: 14 } as const;

export const size = { touch: 56, roundButton: 64, progress: 10, tile: 76, routeLine: 7, routeLineCasing: 2, avatar: 84 } as const;

export const blur = { glass: 28, backdrop: 3 } as const;

export const shadow = {
  card: '0 24px 60px -12px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.35)',
  /** AOS18: a többi webes `box-shadow` (styles.css), hogy az iOS ugyanezekből rajzoljon. */
  sign: '0 8px 24px rgba(0,0,0,0.45)',
  knob: '0 2px 6px rgba(0,0,0,0.35)',
  startMark: '0 12px 40px rgba(0,0,0,0.5)',
  cameraPin: '0 4px 10px rgba(0,0,0,0.45)',
  routeLabel: '0 3px 8px rgba(0,0,0,0.35)',
  puck: '0 4px 14px rgba(0,0,0,0.5)',
  reportPin: '0 6px 18px rgba(0,0,0,0.5)',
} as const;

export const motion = {
  fast: 160,
  base: 280,
  slow: 480,
  /** Adatkövető átmenet (progress, kamera) – a GPS 1 Hz-es üteme. */
  data: 1000,
  ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  /** Natív animációhoz ugyanaz a görbe, kontrollpontokként. */
  easePoints: [0.2, 0.8, 0.2, 1],
} as const;

/**
 * AW23: a követő kamera minden állapotban (üresjárat, krúzing, navigáció, navigáció vége) ugyanaz, weben és iOS-en. A jelölő a
 * képernyő alsó részén, a legfelső alsó kártya fölött `focusGap`-pel (0 = fent, 1 = lent), előre minél nagyobb rálátással.
 */
export const camera = {
  pitch: 58,
  focusMaxY: 0.8,
  focusMinY: 0.18,
  /** A kerek gombok (12 + 64 + 12) és a jelölő kúpja fölé. */
  focusGap: 112,
  /** A jelölő helyének, a zoomnak és a visszaállásnak az ideje (ms). */
  focusTau: 150,
  zoomTau: 1500,
  recenter: 900,
  /** km/h → zoom: városban közelebb, autópályán távolabb; között lineáris, a széleken állandó. */
  zoomStops: [
    [30, 17.2],
    [50, 16.8],
    [90, 15.6],
    [130, 14.8],
  ] as readonly (readonly [number, number])[],
} as const;

export const tokens = { color, statusColor, font, type, space, radius, radiusScale, fontSize, fontWeight, opacity, glow, size, blur, shadow, motion, camera } as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** CSS-változók (`--color-ok: #2EE59D;` …) a `:root`-hoz – a web ebből dolgozik. */
export function toCssVariables(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(color)) lines.push(`--color-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(statusColor)) lines.push(`--status-${k}: ${v};`);
  lines.push(`--font-family: ${font.family};`);
  for (const [k, v] of Object.entries(type)) {
    if (typeof v === 'number') continue;
    lines.push(
      `--type-${k}-size: ${v.size}px;`,
      `--type-${k}-weight: ${v.weight};`,
      `--type-${k}-line: ${v.lineHeight};`,
      `--type-${k}-tracking: ${v.tracking}em;`,
    );
  }
  lines.push(`--type-hero-fluid: clamp(${type.heroMin}px, ${type.heroVw}vw, ${type.hero.size}px);`);
  for (const [k, v] of Object.entries(space)) lines.push(`--space-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(radius)) lines.push(`--radius-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(size)) lines.push(`--size-${kebab(k)}: ${v}px;`);
  lines.push(`--blur-glass: ${blur.glass}px;`, `--shadow-card: ${shadow.card};`);
  for (const k of ['fast', 'base', 'slow', 'data'] as const) lines.push(`--motion-${k}: ${motion[k]}ms;`);
  lines.push(`--motion-ease: ${motion.ease};`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Swift (iOS-app, A9)
// ---------------------------------------------------------------------------

/** `#RRGGBB` / `rgba(r,g,b,a)` → [r, g, b, a] (0…1). */
export function parseColor(v: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(v);
  if (rgba) return [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255, Number(rgba[4])];
  throw new Error(`ismeretlen színformátum: ${v}`);
}

/** `0 24px 60px -12px rgba(…)` → x, y, elmosás, szórás, szín (a CSS-árnyék rétegei). */
function parseShadow(v: string): { x: number; y: number; blur: number; spread: number; color: string }[] {
  return v.split(/,(?![^(]*\))/).map((layer) => {
    const m = /^\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s+(-?\d+)(?:px)?(?:\s+(-?\d+)(?:px)?)?\s+(rgba\([^)]*\)|#[0-9a-f]{6})\s*$/i.exec(layer);
    if (!m) throw new Error(`ismeretlen árnyék: ${layer}`);
    return { x: Number(m[1]), y: Number(m[2]), blur: Number(m[3]), spread: Number(m[4] ?? 0), color: m[5]! };
  });
}

const num = (n: number) => (Number.isInteger(n) ? `${n}` : `${Number(n.toFixed(6))}`);
const swiftColor = (v: string) => {
  const [r, g, b, a] = parseColor(v).map((x) => num(Number(x.toFixed(6))));
  return `Color(.sRGB, red: ${r}, green: ${g}, blue: ${b}, opacity: ${a})`;
};
const swiftName = (k: string) => (/^\d/.test(k) ? `s${k}` : k);

/**
 * Swift-forrás az iOS-apphoz (`apps/ios/Atlagsebesseg/Generated/DesignTokens.swift`): ugyanazok az
 * értékek, mint a CSS-változókban. Generálja: `npm run generate -w @atlagsebesseg/ios`.
 */
export function toSwift(): string {
  const colorKey = (v: string) => Object.entries(color).find(([, c]) => c === v)?.[0];
  const L: string[] = [
    '// GENERÁLT FÁJL – kézzel ne szerkeszd.',
    '// Forrás: packages/design-tokens/src/index.ts; újragenerálás: npm run generate -w @atlagsebesseg/ios',
    '',
    'import SwiftUI',
    '',
    '/// Dizájn-tokenek (DESIGN.md) – a webes CSS-változók Swift-megfelelője.',
    'enum Tokens {',
    '    enum Colors {',
  ];
  for (const [k, v] of Object.entries(color)) L.push(`        /// \`${v}\``, `        static let ${k} = ${swiftColor(v)}`);
  L.push('    }', '', '    /// Státusz → szín (a nagy szám, a progress és az aktív szakasz vonala).', '    enum StatusColors {');
  for (const [k, v] of Object.entries(statusColor)) {
    const ref = colorKey(v);
    L.push(`        static let ${swiftName(k)} = ${ref ? `Colors.${ref}` : swiftColor(v)}`);
  }
  L.push('    }', '', '    /// A betűcsalád (a web `Inter Variable`-je; az app a Resources/Fonts/InterVariable.ttf-et regisztrálja).', '    enum Fonts {', `        static let family = ${JSON.stringify(font.nativeFamily)}`, '    }', '', '    enum Typography {');
  for (const [k, v] of Object.entries(type)) {
    if (typeof v === 'number') L.push(`        static let ${k}: CGFloat = ${num(v)}`);
    else L.push(`        static let ${k} = TypeStyle(size: ${num(v.size)}, weight: ${num(v.weight)}, lineHeight: ${num(v.lineHeight)}, tracking: ${num(v.tracking)})`);
  }
  L.push('    }', '', '    enum Space {');
  for (const [k, v] of Object.entries(space)) L.push(`        static let ${swiftName(k)}: CGFloat = ${num(v)}`);
  L.push('    }', '', '    enum Radius {');
  for (const [k, v] of Object.entries({ ...radius, ...radiusScale })) L.push(`        static let ${k}: CGFloat = ${num(v)}`);
  L.push('    }', '', '    /// Betűméret (pt) és -súly (AOS18: az iOS-en literál tilos, AppTests-őr).', '    enum FontSize {');
  for (const [k, v] of Object.entries(fontSize)) L.push(`        static let ${k}: CGFloat = ${num(v)}`);
  L.push('    }', '', '    enum FontWeight {');
  for (const [k, v] of Object.entries(fontWeight)) L.push(`        static let ${k}: CGFloat = ${num(v)}`);
  L.push('    }', '', '    enum Opacity {');
  for (const [k, v] of Object.entries(opacity)) L.push(`        static let ${k}: Double = ${num(v)}`);
  L.push('    }', '', '    /// AW23: a követő kamera (web + iOS azonos számokkal).', '    nonisolated enum Camera {');
  L.push(`        static let pitch: Double = ${num(camera.pitch)}`, `        static let focusMaxY: Double = ${num(camera.focusMaxY)}`, `        static let focusMinY: Double = ${num(camera.focusMinY)}`, `        static let focusGap: Double = ${num(camera.focusGap)}`, `        static let focusTau: Double = ${num(camera.focusTau)}`, `        static let zoomTau: Double = ${num(camera.zoomTau)}`, `        static let recenter: Double = ${num(camera.recenter)}`);
  L.push(`        static let zoomStops: [(kmh: Double, zoom: Double)] = [${camera.zoomStops.map(([s, z]) => `(${num(s)}, ${num(z)})`).join(', ')}]`);
  L.push('    }', '', '    /// A SwiftUI `shadow(radius:)` a CSS-elmosás fele.', '    enum Glow {');
  for (const [k, v] of Object.entries(glow)) L.push(`        static let ${k}: CGFloat = ${num(v / 2)}`);
  L.push('    }', '', '    enum Size {');
  for (const [k, v] of Object.entries(size)) L.push(`        static let ${k}: CGFloat = ${num(v)}`);
  L.push('    }', '', '    enum Blur {');
  for (const [k, v] of Object.entries(blur)) L.push(`        static let ${k}: CGFloat = ${num(v)}`);
  L.push('    }', '', '    enum Shadow {');
  for (const [k, v] of Object.entries(shadow)) {
    const layers = parseShadow(v).map((s) => `ShadowLayer(x: ${s.x}, y: ${s.y}, blur: ${s.blur}, spread: ${s.spread}, color: ${swiftColor(s.color)})`);
    L.push(`        static let ${k}: [ShadowLayer] = [`, ...layers.map((l) => `            ${l},`), '        ]');
  }
  L.push('    }', '', '    /// Másodpercben (a token ms-ben van).', '    enum Motion {');
  for (const k of ['fast', 'base', 'slow', 'data'] as const) L.push(`        static let ${k}: Double = ${num(motion[k] / 1000)}`);
  L.push(`        static let easePoints: (Double, Double, Double, Double) = (${motion.easePoints.map(num).join(', ')})`);
  L.push('    }', '}', '', '/// Egy típus-lépcső: méret (pt), súly (100–900), sormagasság (szorzó), betűköz (em).');
  L.push('struct TypeStyle {', '    let size: CGFloat', '    let weight: CGFloat', '    let lineHeight: CGFloat', '    let tracking: CGFloat', '}', '');
  L.push('/// A CSS `box-shadow` egy rétege (`spread` SwiftUI-ban nem jeleníthető meg, csak tájékoztató).');
  L.push('struct ShadowLayer {', '    let x: CGFloat', '    let y: CGFloat', '    let blur: CGFloat', '    let spread: CGFloat', '    let color: Color', '}', '');
  return L.join('\n');
}
