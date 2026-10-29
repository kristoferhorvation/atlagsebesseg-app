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

/** WCAG relatív fénysűrűség és kontrasztarány (`#RRGGBB`). */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('útvonal-színek (A8d)', () => {
  it('az alternatíva a kék és a térkép háttér 55/45 keveréke (nappal és éjjel)', () => {
    for (const [alt, bg] of [
      [color.routeAltDay, color.mapBgDay],
      [color.routeAltNight, color.mapBgNight],
    ] as const) {
      const mix = rgb(color.route).map((c, i) => 0.55 * c + 0.45 * rgb(bg)[i]!);
      rgb(alt).forEach((c, i) => expect(Math.abs(c - mix[i]!)).toBeLessThanOrEqual(0.5));
    }
  });
  it('kontraszt: a kiválasztott kiemelkedik, az alternatíva kontúrja nappal, a vonala éjjel látszik', () => {
    // a kiválasztott vonal mindkét háttéren (a fehér kontúr éjjel külön is)
    expect(contrast(color.route, color.mapBgDay)).toBeGreaterThan(4);
    expect(contrast(color.route, color.mapBgNight)).toBeGreaterThan(3);
    expect(contrast(color.routeCasing, color.mapBgNight)).toBeGreaterThan(15);
    // az alternatíva: nappal a sötét kontúr viszi, éjjel a tömör vonal (a kontúr ott beleolvad)
    expect(contrast(color.routeAltCasing, color.mapBgDay)).toBeGreaterThan(10);
    expect(contrast(color.routeAltDay, color.mapBgDay)).toBeGreaterThan(2);
    expect(contrast(color.routeAltNight, color.mapBgNight)).toBeGreaterThan(1.7);
    // a kettő egymástól is elválik (a kiválasztott a világosabb kontúrral)
    expect(contrast(color.route, color.routeAltDay)).toBeGreaterThan(1.9);
    expect(contrast(color.route, color.routeAltNight)).toBeGreaterThan(1.7);
  });
});
