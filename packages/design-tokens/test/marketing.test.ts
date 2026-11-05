import { describe, expect, it } from 'vitest';
import { color, shadow } from '../src';
import prompt from '../../../docs/marketing/lovable-prompt.md?raw';

// AW22b: a Lovable-brief (docs/marketing/lovable-prompt.md) nem találhat ki színt – minden hex és rgba() a tokenekből jön.
const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const hexes = new Set(Object.values(color).filter((v) => v.startsWith('#')).map(norm));
const rgbas = new Set([...Object.values(color), ...Object.values(shadow)].flatMap((v) => v.match(/rgba\([^)]*\)/g) ?? []).map(norm));

describe('Lovable-brief', () => {
  it('minden hex a design-tokens színei közül való', () => {
    const found = prompt.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(found.length).toBeGreaterThan(20);
    expect(found.filter((h: string) => !hexes.has(norm(h)))).toEqual([]);
  });
  it('minden rgba() egy szín- vagy árnyék-token értéke', () => {
    const found = prompt.match(/rgba\([^)]*\)/g) ?? [];
    expect(found.length).toBeGreaterThan(5);
    expect(found.filter((c: string) => !rgbas.has(norm(c)))).toEqual([]);
  });
  it('a három állapotszín és a háttér szerepel', () => {
    for (const v of [color.bg, color.text, color.ok, color.near, color.over]) expect(prompt).toContain(v);
  });
});
