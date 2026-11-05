// AW23: élő próba a Search Box API-n (kevés munkamenet): „Allee”, „Mammut” név szerint, címkeresés, retrieve az Allee-ra; és a Directions lámpa-adata.
// Futtatás: npx tsx apps/web/scripts/searchbox-live.mts  (a token az apps/web/.env-ből, értéket nem ír ki)
import { readFileSync } from 'node:fs';
import { directionsUrl, parseDirections, parseRetrieve, parseSuggest, retrieveUrl, suggestUrl } from '../../../packages/app-logic/src/navigation';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const TOKEN = raw.match(/^VITE_MAPBOX_TOKEN=(.+)$/m)?.[1]?.trim() ?? '';
const NEAR = { lat: 47.4979, lon: 19.0402 };
let bad = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'HIBA'} ${name} ${detail}`);
};
for (const [q, want] of [['Allee', /allee/i], ['Mammut', /mammut/i], ['Andrássy út 10', /andrássy/i]] as const) {
  const session = crypto.randomUUID();
  const res = await fetch(suggestUrl(q, 'hu', TOKEN, session, NEAR));
  const hits = parseSuggest(await res.json(), q);
  check(`„${q}”: HTTP ${res.status}, ${hits.length} találat`, res.ok && hits.some((h) => want.test(h.name)), hits.slice(0, 3).map((h) => `${h.name} | ${h.address} | ${h.distanceM ?? '–'} m`).join(' ; '));
  const hit = hits[0];
  if (q === 'Allee') check('„Allee”: a közeli találatok előre, a 190 km-re lévő osztrák utca nem az első', hits[0]!.distanceM! < 50_000, hits[0]!.name);
  if (q === 'Mammut') check('„Mammut”: a pláza az első', hits[0]!.name === 'Mammut', hits[0]!.address);
  if (hit && q === 'Allee') {
    const r = await fetch(retrieveUrl(hit.retrieveId!, 'hu', TOKEN, session));
    const place = parseRetrieve(await r.json(), hit);
    check('retrieve: koordináta Budapesten', !!place && Math.abs(place.lat - 47.47) < 0.1 && Math.abs(place.lon - 19.05) < 0.1, JSON.stringify(place));
  }
}
// a web és az iOS ugyanezt a címet építi (azonos paraméter-sorrend, teszt mindkét oldalon); a lámpa-adat és az útkategória az élő válaszból
const url = directionsUrl(NEAR, { lat: 47.4731, lon: 19.0496 }, 'hu', TOKEN, {});
console.log('Directions-cím (token nélkül):', url.replace(TOKEN, 'pk.x'));
const j = (await (await fetch(url)).json()) as { routes: { legs: { steps: { intersections?: { traffic_signal?: boolean; mapbox_streets_v8?: { class?: string } }[] }[] }[]; distance: number; duration: number; duration_typical?: number }[] };
const inter = j.routes.flatMap((r) => r.legs.flatMap((l) => l.steps.flatMap((s) => s.intersections ?? [])));
const parsed = parseDirections(j);
check('Directions: útvonal + kereszteződések', parsed.length > 0 && inter.length > 0, `${parsed.length} útvonal, ${inter.length} kereszteződés, ${inter.filter((x) => x.traffic_signal).length} jelzőlámpa`);
check('Directions: útkategória a lépésekben', parsed[0]!.steps.some((s) => s.roadClass !== null), [...new Set(parsed[0]!.steps.map((s) => s.roadClass))].join(','));
check('Directions: lámpa-pontok', parsed[0]!.stopPointsM.length > parsed[0]!.steps.length, `${parsed[0]!.stopPointsM.length} pont, ${parsed[0]!.steps.length} lépés`);
console.log(parsed.map((r) => `${Math.round(r.distanceM)} m, ${Math.round(r.durationS)} s`).join(' | '));
process.exit(bad ? 1 : 0);
