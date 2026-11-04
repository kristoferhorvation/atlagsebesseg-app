import { describe, expect, it } from 'vitest';
import { applyMasks, blur, compare, diffImages, downscale } from '../scripts/diff-core.mjs';

/** Egyszínű háttéren sötét kör (a kerek gomb) – pt-méretű, RGBA kép. */
function scene(w: number, h: number, cx: number, cy: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = (x - cx) ** 2 + (y - cy) ** 2 < 32 ** 2;
      const k = (y * w + x) * 4;
      data[k] = inside ? 20 : 74;
      data[k + 1] = inside ? 22 : 85;
      data[k + 2] = inside ? 28 : 104;
      data[k + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe('paritás-diff (AOS18)', () => {
  it('azonos kép: zöld', () => {
    const r = compare(blur(scene(200, 200, 100, 100)), blur(scene(200, 200, 100, 100)));
    expect(r.overall).toBe(0);
    expect(r.passed).toBe(true);
  });

  it('a 12 pt-tel elcsúszott kerek gomb bukik (a legrosszabb csempe miatt, nem az átlag miatt)', () => {
    const r = compare(blur(scene(402, 874, 200, 400)), blur(scene(402, 874, 200, 412)));
    expect(r.overall).toBeLessThan(0.03);
    expect(r.tile).toBeGreaterThan(0.18);
    expect(r.passed).toBe(false);
  });

  it('a 8 pt-es elcsúszás is bukik, a ±2 pt-es nem', () => {
    const base = blur(scene(402, 874, 200, 400));
    expect(compare(base, blur(scene(402, 874, 200, 408))).passed).toBe(false);
    expect(compare(base, blur(scene(402, 874, 200, 402))).passed).toBe(true);
  });

  it('a hiányzó gomb bukik', () => {
    const r = compare(blur(scene(402, 874, 200, 400)), blur(scene(402, 874, -100, -100)));
    expect(r.passed).toBe(false);
  });

  it('a maszkolt terület nem számít', () => {
    const a = scene(200, 200, 100, 100);
    const b = scene(200, 200, 60, 60);
    applyMasks(a, b, [{ x: 0, y: 0, w: 200, h: 200 }]);
    expect(compare(blur(a), blur(b)).overall).toBe(0);
  });

  it('a kicsinyítés doboz-szűrő: 3× → pt-méret', () => {
    const big = scene(300, 300, 150, 150);
    const small = downscale(big, 3);
    expect([small.width, small.height]).toEqual([100, 100]);
    expect(small.data[0]).toBe(74);
  });

  it('a teljes lánc a DPR-rel számol', () => {
    const r = diffImages(scene(600, 600, 300, 300), scene(600, 600, 300, 300), 3, []);
    expect(r.passed).toBe(true);
    expect(r.a.width).toBe(200);
  });
});
