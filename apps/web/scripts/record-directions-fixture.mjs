// Egyszeri rögzítés: Budapest → Győr Directions-válasz a szimulátor fixtúrájának (nem része a futásnak).
//   node apps/web/scripts/record-directions-fixture.mjs
// A tokent az apps/web/.env-ből olvassa (nem írja ki); a kimenet a koordinátákat 5 tizedesre kerekíti,
// a lépés-geometriát és a kereszteződéseket elhagyja (a feldolgozó nem használja).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env'), 'utf8');
const token = /^VITE_MAPBOX_TOKEN=(.+)$/m.exec(env)?.[1]?.trim();
if (!token) throw new Error('nincs VITE_MAPBOX_TOKEN');
const from = '19.0402,47.4979'; // Budapest, Deák tér
const to = '17.6504,47.6875'; // Győr, főpályaudvar környéke
const q = new URLSearchParams({
  alternatives: 'true', steps: 'true', banner_instructions: 'true', voice_instructions: 'true', geometries: 'geojson', overview: 'full',
  annotations: 'maxspeed,congestion,duration', language: 'hu', access_token: token,
});
const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from};${to}?${q}`, { headers: { Referer: 'http://localhost:5173/' } });
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const json = await res.json();
const r5 = (c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];
for (const route of json.routes) {
  route.geometry.coordinates = route.geometry.coordinates.map(r5);
  for (const leg of route.legs) {
    for (const s of leg.steps) {
      delete s.geometry;
      delete s.intersections;
      s.maneuver.location = r5(s.maneuver.location);
      for (const v of s.voiceInstructions ?? []) delete v.ssmlAnnouncement;
    }
  }
}
delete json.uuid;
const out = join(here, '..', '..', '..', 'packages', 'app-logic', 'src', 'navigation', 'fixtures', 'budapest-gyor.directions.json');
writeFileSync(out, JSON.stringify(json));
console.log(`routes: ${json.routes.length}, ${json.routes.map((r) => `${(r.distance / 1000).toFixed(1)} km / ${(r.duration / 60).toFixed(0)} perc / ${r.geometry.coordinates.length} pont`).join('; ')}`);
