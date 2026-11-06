/**
 * AW25b: országhatárok a kamera-szabályhoz (INV-24, INV-26) – a közösségi bejelentésnek nincs ország-mezője, ezért a
 * koordinátából döntjük el, hogy a nem alapértelmezett szabályú országok (camera_visibility.json: nem `show` vagy
 * figyelmeztetéssel) egyikében van-e. Forrás: Natural Earth 1:10m Admin 0 (közkincs, https://www.naturalearthdata.com/),
 * csak az európai poligonok, Douglas–Peucker-egyszerűsítéssel. Kimenet: packages/data/country_borders.json.
 *
 * Futtatás: `npx tsx packages/data/scripts/build-country-borders.ts` (a nyers fájl a packages/data/cache/naturalearth-be kerül).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const CACHE = join(ROOT, 'cache/naturalearth/ne_10m_admin_0_countries.geojson');
const OUT = join(ROOT, 'country_borders.json');
/** ~150 m: a határ menti tévedés ennyi, a szabály szempontjából elég. */
const TOLERANCE_DEG = 0.0015;
/** Európa (a tengerentúli francia területek kimaradnak). */
const EUROPE = { west: -12, east: 32, south: 34, north: 72 };

type Ring = [number, number][];

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplify(points: Ring, tol: number): Ring {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1;
    let bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = perpDist(points[k]!, points[i]!, points[j]!);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const inEurope = (ring: Ring) => ring.some(([lon, lat]) => lon >= EUROPE.west && lon <= EUROPE.east && lat >= EUROPE.south && lat <= EUROPE.north);
const round = (v: number) => Math.round(v * 1e4) / 1e4;

if (!existsSync(CACHE)) {
  mkdirSync(dirname(CACHE), { recursive: true });
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`Natural Earth: HTTP ${res.status}`);
  writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
}

const rules = JSON.parse(readFileSync(join(ROOT, 'camera_visibility.json'), 'utf8')) as { default: string; countries: Record<string, { mode: string; warning?: string }> };
const wanted = Object.entries(rules.countries)
  .filter(([, r]) => r.mode !== rules.default || r.warning)
  .map(([c]) => c)
  .sort();

const ne = JSON.parse(readFileSync(CACHE, 'utf8')) as { features: { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }[] };
const countries: Record<string, Ring[][]> = {};
for (const code of wanted) {
  const f = ne.features.find((x) => x.properties.ISO_A2_EH === code && x.properties.ADMIN !== 'Clipperton Island');
  if (!f) throw new Error(`nincs ilyen ország a Natural Earth-ben: ${code}`);
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
  countries[code] = polys
    .filter((p) => inEurope(p[0]!))
    .map((p) => p.map((ring) => simplify(ring, TOLERANCE_DEG).map(([lon, lat]) => [round(lon), round(lat)] as [number, number])).filter((r) => r.length >= 4))
    .filter((p) => p.length > 0);
}

const out = {
  $comment:
    'AW25b: a nem alapértelmezett kamera-szabályú országok határa (camera_visibility.json), a közösségi bejelentések országához. Forrás: Natural Earth 1:10m Admin 0 (közkincs), Douglas–Peucker 0,0015° (~150 m), [lon, lat]. Generált: packages/data/scripts/build-country-borders.ts.',
  source: 'Natural Earth 1:10m Admin 0 – Countries (public domain)',
  toleranceDeg: TOLERANCE_DEG,
  countries,
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`${wanted.join(', ')} → ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB, ${Object.values(countries).flat(2).reduce((n, r) => n + r.length, 0)} pont)`);
