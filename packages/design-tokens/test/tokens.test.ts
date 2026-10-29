import { describe, expect, it } from 'vitest';
import { color, statusColor, toCssVariables } from '../src';

describe('design-tokens', () => {
  it('CSS-változók: minden szín és a fluid hero', () => {
    const css = toCssVariables();
    for (const v of Object.values(color)) expect(css).toContain(v);
    expect(css).toContain('--status-tul: #FF4D61;');
    expect(css).toContain('--type-hero-fluid: clamp(120px, 42vw, 196px);');
    expect(css).toContain('--color-surface-strong:');
  });
  it('a státuszszínek a palettából jönnek', () => {
    expect(Object.values(statusColor).every((c) => (Object.values(color) as string[]).includes(c))).toBe(true);
  });
});

/** `#RRGGBB` vagy `rgba(r,g,b,a)` → [r, g, b, a]. */
const rgba = (c: string): number[] =>
  c.startsWith('#') ? [...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), 1] : c.slice(5, -1).split(',').map(Number);
const rgb = (c: string) => rgba(c).slice(0, 3);
const hex = (v: number[]) => `#${v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/** `a` súllyal `w` a `b` fölé keverve (átlátszó szín: a saját alfájával). */
const mix = (a: string, b: string, w = rgba(a)[3]!) => hex(rgb(a).map((c, i) => w * c + (1 - w) * rgb(b)[i]!));
/** WCAG relatív fénysűrűség és kontrasztarány (`#RRGGBB`). */
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('útvonal-színek (A8d, AW11)', () => {
  it('az alternatíva nappal a kék és a térkép háttér 55/45, éjjel 70/30 keveréke', () => {
    expect(color.routeAltDay).toBe(mix(color.route, color.mapBgDay, 0.55));
    expect(color.routeAltNight).toBe(mix(color.route, color.mapBgNight, 0.7));
  });
  it('éjjel a kontúr világos: a nappali térkép-háttér színe 60%-on', () => {
    expect(rgba(color.routeAltCasingNight)).toEqual([...rgb(color.mapBgDay), 0.6]);
  });
  it('kontraszt: a kiválasztott kiemelkedik, az alternatíva nappal és éjjel is látszik', () => {
    const casingNight = mix(color.routeAltCasingNight, color.mapBgNight);
    // a kiválasztott vonal mindkét háttéren (a fehér kontúr éjjel külön is)
    expect(contrast(color.route, color.mapBgDay)).toBeGreaterThan(4);
    expect(contrast(color.route, color.mapBgNight)).toBeGreaterThan(3);
    expect(contrast(color.routeCasing, color.mapBgNight)).toBeGreaterThan(15);
    // nappal: a sötét kontúr viszi, a vonal is elválik a háttértől
    expect(contrast(color.routeAltCasingDay, color.mapBgDay)).toBeGreaterThan(10);
    expect(contrast(color.routeAltDay, color.mapBgDay)).toBeGreaterThan(2);
    // éjjel: a világos kontúr a háttértől és a vonaltól is elválik, a vonal is erősebb a háttéren
    expect(contrast(casingNight, color.mapBgNight)).toBeGreaterThan(5);
    expect(contrast(casingNight, color.routeAltNight)).toBeGreaterThan(2.5);
    expect(contrast(color.routeAltNight, color.mapBgNight)).toBeGreaterThan(2);
    // a kettő egymástól: nappal a szín, éjjel a kontúr (fehér vs. 60%-os világos) választja el
    expect(contrast(color.route, color.routeAltDay)).toBeGreaterThan(1.9);
    expect(contrast(color.route, color.routeAltNight)).toBeGreaterThan(1.4);
    expect(contrast(color.routeCasing, casingNight)).toBeGreaterThan(2.5);
  });
});
