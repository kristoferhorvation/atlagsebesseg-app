// Két kép egymás mellett (régi → új): tsx packages/parity/scripts/side-by-side.mjs <bal.png> <jobb.png> <ki.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [a, b] = process.argv.slice(2, 4).map((f) => PNG.sync.read(readFileSync(f)));
const scale = (img, h) => {
  const k = h / img.height;
  const w = Math.round(img.width * k);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / k));
      const sy = Math.min(img.height - 1, Math.floor(y / k));
      img.data.copy(out.data, (y * w + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  return out;
};
const h = Math.min(a.height, b.height);
const [l, r] = [scale(a, h), scale(b, h)];
const gap = 24;
const out = new PNG({ width: l.width + gap + r.width, height: h });
out.data.fill(255);
PNG.bitblt(l, out, 0, 0, l.width, h, 0, 0);
PNG.bitblt(r, out, 0, 0, r.width, h, l.width + gap, 0);
writeFileSync(process.argv[4], PNG.sync.write(out));
