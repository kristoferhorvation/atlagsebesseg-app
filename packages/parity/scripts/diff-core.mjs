// A képernyő-diff magja (AOS18): pt-felbontásra kicsinyített, enyhén elmosott képek pixelmatch-e; a kép egészére és a legrosszabb
// csempére is van küszöb, hogy a kis területű, de nagy eltérés (elcsúszott gomb) se vesszen el az átlagban.
import { readFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * `overall`: az eltérő pixelek aránya a kép egészén. `tile`: a legrosszabb `tileSize` pt-es csempe eltérése, ahol a csempe ±`slack` pt-en belül a legjobb illesztésével
 * számít, és csak a `colorDelta`-nál nagyobb színeltérés hibás: a két szövegmotor 1–2 pt-es elhelyezése és élsimítása nem hiba. Mért érzékenység: egy kerek gomb 4 pt-es
 * elcsúszása 5%, 6 pt 15%, 8 pt 23%, 12 pt 40%; a mért zaj (AOS18) legfeljebb 17%, ezért a határ 18% – a 8 pt-es elcsúszás, a hiányzó elem, a más tördelés bukik.
 * A pontos méreteket a `ParityTests` méri (±0,5–4 pt), a színeket a tokeneken át.
 */
export const THRESHOLDS = { overall: 0.04, tile: 0.18, tileSize: 24, pixel: 0.16, slack: 2, colorDelta: 46 };

export function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

/** Kicsinyítés egész szorzóval (doboz-szűrő). */
export function downscale(img, factor) {
  if (factor === 1) return { width: img.width, height: img.height, data: Uint8ClampedArray.from(img.data) };
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0, 0];
      for (let j = 0; j < factor; j++) {
        for (let i = 0; i < factor; i++) {
          const k = ((y * factor + j) * img.width + (x * factor + i)) * 4;
          for (let c = 0; c < 4; c++) sum[c] += img.data[k + c];
        }
      }
      const t = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) data[t + c] = sum[c] / (factor * factor);
    }
  }
  return { width: w, height: h, data };
}

/** Enyhe (3 × 3) elmosás: az 1 pt alatti élsimítás-eltérés nem számít, a valódi elcsúszás igen. */
export function blur(img) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const K = [1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        let n = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const yy = y + j;
            const xx = x + i;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            const f = K[i + 1] * K[j + 1];
            s += data[(yy * w + xx) * 4 + c] * f;
            n += f;
          }
        }
        out[(y * w + x) * 4 + c] = s / n;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Egy maszk-téglalap (pt) kitöltése mindkét képen ugyanazzal a színnel. */
export function applyMasks(a, b, masks) {
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor(m.x));
    const y0 = Math.max(0, Math.floor(m.y));
    const x1 = Math.min(a.width, Math.ceil(m.x + m.w));
    const y1 = Math.min(a.height, Math.ceil(m.y + m.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const k = (y * a.width + x) * 4;
        for (const img of [a, b]) {
          img.data[k] = 255;
          img.data[k + 1] = 0;
          img.data[k + 2] = 255;
          img.data[k + 3] = 255;
        }
      }
    }
  }
}

/** Két azonos méretű kép összevetése: az eltérő pixelek aránya és a legrosszabb csempe. */
export function compare(a, b, thresholds = THRESHOLDS) {
  const output = new Uint8Array(a.data.length);
  const count = pixelmatch(a.data, b.data, output, a.width, a.height, { threshold: thresholds.pixel, includeAA: true, alpha: 0.25, diffColor: [255, 0, 60] });
  const size = thresholds.tileSize;
  const slack = thresholds.slack ?? 0;
  const delta = thresholds.colorDelta ?? 26;
  let worst = 0;
  let worstAt = null;
  const W = a.width;
  const H = a.height;
  for (let ty = 0; ty < H; ty += size) {
    for (let tx = 0; tx < W; tx += size) {
      const x1 = Math.min(W, tx + size);
      const y1 = Math.min(H, ty + size);
      const total = (x1 - tx) * (y1 - ty);
      let best = Infinity;
      for (let dy = -slack; dy <= slack && best > 0; dy++) {
        for (let dx = -slack; dx <= slack && best > 0; dx++) {
          let bad = 0;
          for (let y = ty; y < y1 && bad < best; y++) {
            const yy = y + dy;
            if (yy < 0 || yy >= H) { bad += x1 - tx; continue; }
            for (let x = tx; x < x1; x++) {
              const xx = x + dx;
              if (xx < 0 || xx >= W) { bad++; continue; }
              const p = (y * W + x) * 4;
              const q = (yy * W + xx) * 4;
              const d = (Math.abs(a.data[p] - b.data[q]) + Math.abs(a.data[p + 1] - b.data[q + 1]) + Math.abs(a.data[p + 2] - b.data[q + 2])) / 3;
              if (d > delta) bad++;
            }
          }
          if (bad < best) best = bad;
        }
      }
      const r = best / total;
      if (r > worst) {
        worst = r;
        worstAt = { x: tx, y: ty };
      }
    }
  }
  const overall = count / (a.width * a.height);
  return { overall, tile: worst, tileAt: worstAt, output, passed: overall <= thresholds.overall && worst <= thresholds.tile };
}

/** A teljes lánc két PNG-re (a nyers szimulátor-kép mérete a web DPR-jével egyezik). */
export function diffImages(webImg, iosImg, dpr, masks, thresholds = THRESHOLDS) {
  const a = downscale(webImg, dpr);
  const b = downscale(iosImg, dpr);
  applyMasks(a, b, masks);
  const r = compare(blur(a), blur(b), thresholds);
  return { ...r, a, b };
}

/** A web · iOS · diff egymás mellett, pt-felbontásban. */
export function sideBySide(a, b, output) {
  const w = a.width;
  const h = a.height;
  const gap = 8;
  const png = new PNG({ width: w * 3 + gap * 2, height: h });
  png.data.fill(255);
  const put = (src, ox) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const t = (y * png.width + x + ox) * 4;
        for (let c = 0; c < 4; c++) png.data[t + c] = src[s + c];
      }
    }
  };
  put(a.data, 0);
  put(b.data, w + gap);
  put(output, 2 * (w + gap));
  return PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });
}
