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
