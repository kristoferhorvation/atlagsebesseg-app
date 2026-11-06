// AW24: a `?heatSeed` / `-heatSeed YES` szimulátor-adat felvétele: valódi utak geometriája, hogy a hőtérkép-kép utcákon haladó csíkokat mutasson.
// AW25b (Mapbox-feltételek: a Directions-eredmény nem tárolható): a geometria az OSRM nyilvános demó-szerveréről jön (OpenStreetMap-adat,
// © OpenStreetMap contributors, ODbL), token nélkül, másodpercenként legfeljebb egy kéréssel.
// Használat: npx tsx apps/web/scripts/record-heat-seed.mts
import { writeFileSync } from 'node:fs';

/** [név, áthaladás, km/h, lon,lat;lon,lat…] */
const ROUTES: [string, number, number, string][] = [
  ['nagykörút', 14, 34, '19.0536,47.5118;19.0702,47.5013;19.0705,47.4931;19.0610,47.4835'],
  ['margit-móricz', 11, 42, '19.0453,47.5137;19.0405,47.5010;19.0475,47.4770'],
  ['andrássy', 8, 38, '19.0553,47.4990;19.0815,47.5150'],
  ['rákóczi-kerepesi', 6, 48, '19.0586,47.4944;19.0880,47.5007;19.1290,47.5002'],
  ['üllői', 5, 52, '19.0640,47.4870;19.1000,47.4680;19.1500,47.4490'],
  ['váci', 4, 56, '19.0575,47.5135;19.0720,47.5500;19.0870,47.5800'],
  ['hungária', 3, 62, '19.0460,47.4640;19.0910,47.4890;19.0960,47.5200;19.0660,47.5340'],
  ['szentendrei', 2, 68, '19.0407,47.5136;19.0425,47.5578;19.0628,47.6126'],
  ['m1', 2, 118, '19.0200,47.4800;18.8237,47.4725;18.4021,47.5605'],
  ['budai', 1, 31, '19.0340,47.5010;19.0200,47.5160;19.0030,47.5230'],
];
const routes = [];
for (const [name, passes, kmh, coords] of ROUTES) {
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`, { headers: { 'User-Agent': 'atlagsebesseg-app fixture (heat-seed)' } });
  const j = (await r.json()) as { code: string; routes: { geometry: { coordinates: [number, number][] }; distance: number }[] };
  if (j.code !== 'Ok') throw new Error(`OSRM: ${name} → ${j.code}`);
  await new Promise((ok) => setTimeout(ok, 1100));
  const c = j.routes[0]!.geometry.coordinates.map(([lon, lat]) => [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6]);
  console.log(name, c.length, Math.round(j.routes[0]!.distance));
  routes.push({ name, passes, kmh, coords: c });
}
writeFileSync(new URL('../../../packages/app-logic/src/fixtures/heat-seed-routes.json', import.meta.url), `${JSON.stringify({ source: `OpenStreetMap (© OpenStreetMap contributors, ODbL), OSRM-útvonal (router.project-osrm.org, ${new Date().toISOString().slice(0, 10)}), csak a szimulátor képeihez`, routes })}\n`);
