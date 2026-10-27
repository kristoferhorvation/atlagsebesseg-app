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
  signRing: '#E5303F',
  signFace: '#FFFFFF',
  signText: '#0B0C10',
} as const;

export type ColorToken = keyof typeof color;

/** Státusz → szín (a nagy szám, a progress és az aktív szakasz vonala). */
export const statusColor = {
  jo: color.ok,
  hataron: color.near,
  tul: color.over,
  semleges: color.idle,
  kezi: color.accent,
} as const;

export type StatusTone = keyof typeof statusColor;

export const font = {
  family: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
  /** Natív appban a betöltött Inter-változat neve. */
  nativeFamily: 'Inter',
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
