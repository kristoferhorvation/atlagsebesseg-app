import { describe, expect, it } from 'vitest';
import { color, parseColor, statusColor, toSwift } from '../src';

describe('Swift-tokenek (iOS)', () => {
  it('színformátumok', () => {
    expect(parseColor('#FF4D61')).toEqual([1, 77 / 255, 97 / 255, 1]);
    expect(parseColor('rgba(14,16,22,0.72)')).toEqual([14 / 255, 16 / 255, 22 / 255, 0.72]);
    expect(() => parseColor('red')).toThrow();
  });
  it('minden szín és státusz szerepel, a státusz a palettára hivatkozik', () => {
    const swift = toSwift();
    for (const k of Object.keys(color)) expect(swift).toContain(`static let ${k} = Color(`);
    for (const k of Object.keys(statusColor)) expect(swift).toMatch(new RegExp(`static let ${k} = Colors\\.\\w+`));
    expect(swift).toContain('static let hero = TypeStyle(size: 196, weight: 680, lineHeight: 0.9, tracking: -0.045)');
    expect(swift).toContain('static let s4: CGFloat = 16');
    expect(swift).toContain('ShadowLayer(x: 0, y: 24, blur: 60, spread: -12');
  });
});
