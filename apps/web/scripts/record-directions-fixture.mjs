// Egyszeri rögzítés: Budapest → Győr Directions-válasz a szimulátor fixtúrájának (nem része a futásnak).
//   npx tsx apps/web/scripts/record-directions-fixture.mjs [--raw <fájl>] [--from-raw <fájl>] [--keep-alt]
// A tokent az apps/web/.env-ből olvassa (nem írja ki); az URL az app `directionsUrl`-je (méteres hang, alternatívák).
// A kimenet a koordinátákat 5 tizedesre kerekíti, a lépés-geometriát és a kereszteződéseket elhagyja (a feldolgozó nem
// használja). AOS13: a tesztek 2 útvonalat várnak – ha a válasz csak egyet ad, a fixtúra nem íródik (kilépés 2-vel), csak
// `--keep-alt`-tal: ekkor a jelenlegi fixtúra 2. útvonala marad, de a mérföldes / lábas hangszövegű lépései hang nélkül.
// `--raw` a nyers választ menti (egy élő hívás így újra felhasználható), `--from-raw` hívás helyett abból dolgozik.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directionsUrl } from '../../../packages/app-logic/src/navigation/directions.ts';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const out = join(here, '..', '..', '..', 'packages', 'app-logic', 'src', 'navigation', 'fixtures', 'budapest-gyor.directions.json');
const from = { lat: 47.4979, lon: 19.0402 }; // Budapest, Deák tér
const to = { lat: 47.6875, lon: 17.6504 }; // Győr, főpályaudvar környéke

let json;
if (arg('--from-raw')) {
  json = JSON.parse(readFileSync(arg('--from-raw'), 'utf8'));
} else {
  const env = readFileSync(join(here, '..', '.env'), 'utf8');
  const token = /^VITE_MAPBOX_TOKEN=(.+)$/m.exec(env)?.[1]?.trim();
  if (!token) throw new Error('nincs VITE_MAPBOX_TOKEN');
  const res = await fetch(directionsUrl(from, to, 'hu', token), { headers: { Referer: 'http://localhost:5173/' } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  json = await res.json();
  if (arg('--raw')) writeFileSync(arg('--raw'), JSON.stringify(json));
}

const summary = (routes) => routes.map((r) => `${(r.distance / 1000).toFixed(1)} km / ${(r.duration / 60).toFixed(0)} perc / ${r.geometry.coordinates.length} pont`).join('; ');
console.log(`élő válasz: ${json.routes.length} útvonal – ${summary(json.routes)}`);

/** Mérföldes / lábas hangszöveg (a régi, `voice_units` nélküli felvételből). */
const IMPERIAL = /mérföld|\bláb\b/i;
if (json.routes.length < 2) {
  if (!process.argv.includes('--keep-alt')) {
    console.log('csak egy útvonal – a fixtúra nem íródott (--keep-alt: a régi 2. útvonal marad)');
    process.exit(2);
  }
  const alt = JSON.parse(readFileSync(out, 'utf8')).routes[1];
  let muted = 0;
  for (const leg of alt.legs) {
    for (const s of leg.steps) {
      if ((s.voiceInstructions ?? []).some((v) => IMPERIAL.test(v.announcement))) {
        s.voiceInstructions = [];
        muted++;
      }
    }
  }
  console.log(`a 2. útvonal a régi felvételből, ${muted} lépés hang nélkül (mérföldes szöveg)`);
  json.routes.push(alt);
}

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
const left = json.routes.flatMap((r) => r.legs.flatMap((l) => l.steps.flatMap((s) => s.voiceInstructions ?? []))).filter((v) => IMPERIAL.test(v.announcement));
if (left.length) throw new Error(`mérföldes hangszöveg maradt: ${left[0].announcement}`);
writeFileSync(out, JSON.stringify(json));
console.log(`fixtúra: ${json.routes.length} útvonal – ${summary(json.routes)}`);
