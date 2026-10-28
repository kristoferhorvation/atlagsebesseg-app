// Az app ikonjai (PNG) függőség nélkül: műszer-ív (jó → határon → túl) sötét alapon.
// Futtatás: npm run icons --workspace apps/web  → public/icons/*.png, public/apple-touch-icon.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG0 = hex('#14161E');
const BG1 = hex('#06070A');
const OK = hex('#2EE59D');
const NEAR = hex('#FFB224');
const OVER = hex('#FF4D61');
const WHITE = [244, 246, 250];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v) => Math.min(1, Math.max(0, v));

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Lekerekített négyzet (szupererellipszis-közelítés) előjeles távolsága, egységnyi koordinátákban. */
function roundedBoxSd(px, py, half, r) {
  const qx = Math.abs(px) - half + r;
  const qy = Math.abs(py) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// ív: 225°-tól −45°-ig (óramutató szerint 270°), a végén egy pötty
const ARC_FROM = (225 * Math.PI) / 180;
const ARC_SPAN = (270 * Math.PI) / 180;

function icon({ maskable = false, rounded = true } = {}) {
  return (x, y, size) => {
    const u = (x / size) * 2 - 1; // −1…1
    const v = (y / size) * 2 - 1;
    const aa = 2 / size;
    const scale = maskable ? 0.72 : 1; // maszkolható ikonnál a tartalom a biztonsági körben
    // háttér
    const sdBox = rounded && !maskable ? roundedBoxSd(u, v, 1, 0.44) : -1;
    const bgA = clamp(0.5 - sdBox / aa);
    let col = mix(BG0, BG1, clamp((v + 1) / 2));
    // ív
    const R = 0.56 * scale;
    const W = 0.15 * scale;
    const ang = Math.atan2(-v, u); // matematikai irány, fel = +
    let t = (ARC_FROM - ang) / ARC_SPAN; // 0…1 óramutató szerint
    t = ((t % (2 * Math.PI / ARC_SPAN)) + 2 * Math.PI / ARC_SPAN) % (2 * Math.PI / ARC_SPAN);
    const dist = Math.abs(Math.hypot(u, v) - R) - W / 2;
    const endA = ARC_FROM;
    const endB = ARC_FROM - ARC_SPAN;
    const capA = Math.hypot(u - R * Math.cos(endA), -v - R * Math.sin(endA)) - W / 2;
    const capB = Math.hypot(u - R * Math.cos(endB), -v - R * Math.sin(endB)) - W / 2;
    const onArc = t <= 1 ? dist : Math.min(capA, capB);
    const arcA = clamp(0.5 - onArc / aa);
    const tt = clamp(t <= 1 ? t : capA < capB ? 0 : 1);
    const arcCol = tt < 0.62 ? mix(OK, NEAR, tt / 0.62) : mix(NEAR, OVER, (tt - 0.62) / 0.38);
    col = mix(col, arcCol, arcA * 0.95);
    // mutató: középpont + a 62%-hoz (határ) mutató vonal
    const needleAng = ARC_FROM - ARC_SPAN * 0.58;
    const nx = Math.cos(needleAng);
    const ny = Math.sin(needleAng);
    const along = u * nx + -v * ny;
    const across = Math.abs(u * -ny + -v * nx);
    const needle = along > 0 && along < R - W * 0.9 ? across - 0.035 * scale * (1 - along / R) - 0.012 * scale : 1;
    const hub = Math.hypot(u, v) - 0.075 * scale;
    const nA = clamp(0.5 - Math.min(needle, hub) / aa);
    col = mix(col, WHITE, nA);
    return [...col.map(Math.round), Math.round(255 * bgA)];
  };
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('icons/icon-192.png', out), png(192, icon()));
writeFileSync(new URL('icons/icon-512.png', out), png(512, icon()));
writeFileSync(new URL('icons/icon-maskable-512.png', out), png(512, icon({ maskable: true })));
// iOS maga kerekít: teljes kitöltésű háttér
writeFileSync(new URL('apple-touch-icon.png', out), png(180, icon({ rounded: false })));
writeFileSync(new URL('icons/favicon-32.png', out), png(32, icon()));
// iOS-app (A9): 1024 px, teljes kitöltésű négyzet (az iOS maga kerekít)
writeFileSync(new URL('../../ios/Atlagsebesseg/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png', out), png(1024, icon({ rounded: false })));
console.log('ikonok kész');
