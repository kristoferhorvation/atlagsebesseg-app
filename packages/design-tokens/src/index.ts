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
  accent: '#7A86FF',
  ok: '#2EE59D',
  near: '#FFB224',
  over: '#FF4D61',
  idle: '#8C93A3',
  /** Tervezett rendőrségi mérés: halvány sárga vonal és sáv (A7) – nem státuszszín. */
  planned: '#F2DC82',
  /** Navigáció (A8d): a kiválasztott útvonal erős kékje és fehér kontúrja. */
  route: '#1F5BFF',
  routeCasing: '#FFFFFF',
  /** Az alternatív útvonal: tömör szürkéskék = `route` 55% + a térkép háttere 45% (nappal / éjjel), sötét kontúrral. */
  routeAltDay: '#799CF8',
  routeAltNight: '#1D40A2',
  routeAltCasing: '#1A2130',
  /** A Mapbox Standard térkép jellemző háttere (a keverékhez és a kontraszt-teszthez). */
  mapBgDay: '#E8EBEF',
  mapBgNight: '#1B2030',
  signRing: '#E5303F',
  signFace: '#FFFFFF',
  signText: '#0B0C10',
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
  kezi: color.accent,
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

export const size = { touch: 56, roundButton: 64, progress: 10, tile: 76 } as const;

export const blur = { glass: 28 } as const;

export const shadow = {
  card: '0 24px 60px -12px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.35)',
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

export const tokens = { color, statusColor, font, type, space, radius, size, blur, shadow, motion } as const;

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
  for (const [k, v] of Object.entries(radius)) L.push(`        static let ${k}: CGFloat = ${num(v)}`);
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
