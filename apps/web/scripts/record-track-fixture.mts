// AW24: a hőtérkép közös fixtúrájának felvétele: valódi budapesti GPS-nyomat (OSM nyilvános nyomok, © OpenStreetMap contributors) + egy tilos megfordulás + egy GPS-kiesés,
// élő Map Matching-válaszok és az OSM-úthálózat a környéken. Használat: npx tsx apps/web/scripts/record-track-fixture.mts <nyomat.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { haversineM } from '@atlagsebesseg/core';
import { mapboxMatchUrl, recordTrace, simplifyForMatch, traceChunks, type TrackPoint } from '@atlagsebesseg/app-logic';

const token = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^VITE_MAPBOX_TOKEN=(.+)$/m)![1]!.trim();
// másodpercenként egy minta, mint az appban
const raw = (JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as [number, number, string][]).filter((p, i, a) => i === 0 || p[2].slice(0, 19) !== a[i - 1]![2].slice(0, 19));
const T0 = Date.parse(raw[0]![2]);
const base = raw.map(([lat, lon, t], i) => {
  const p = raw[i - 1];
  const dt = p ? (Date.parse(t) - Date.parse(p[2])) / 1000 : 1;
  return { t: Date.parse(t) - T0, lat, lon, kmh: p && dt > 0 ? Math.round((haversineM({ lat: p[0], lon: p[1] }, { lat, lon }) / dt) * 36) / 10 : 0 };
});
// GPS-kiesés a nyomat közepén: a pontok kimaradnak, amíg legalább 300 m-nyi táv nem telik el
const gapFrom = Math.floor(base.length * 0.45);
let gapTo = gapFrom;
while (haversineM(base[gapFrom]!, base[gapTo]!) < 300) gapTo++;
const withGap = [...base.slice(0, gapFrom), ...base.slice(gapTo)];
// tilos megfordulás a végén: a kocsi az úton visszafordul, és a saját nyomán megy vissza ~200 m-t
const end = withGap.at(-1)!;
let back = withGap.length - 1;
while (haversineM(withGap[back]!, end) < 200) back--;
const dt = 1200;
const uturnAt = withGap.length;
const returning = withGap.slice(back, -1).reverse().map((p, i) => ({ ...p, t: end.t + (i + 2) * dt, lat: p.lat + 0.00003, lon: p.lon + 0.00003 }));
const trace = [...withGap, ...returning];

const samples = trace.map((p) => ({ tripId: 'budapest', t: p.t, lat: p.lat, lon: p.lon, speedKmh: p.kmh, heading: null, accuracy: 8, h3: null, limitKmh: null }));
const parts = recordTrace(samples);
const matches: unknown[][] = [];
for (const part of parts) {
  const out: unknown[] = [];
  for (const c of traceChunks(simplifyForMatch(part))) {
    const r = await fetch(mapboxMatchUrl(c as TrackPoint[], token));
    const j = (await r.json()) as { code: string; matchings?: { confidence: number; geometry: unknown; legs: { distance: number }[] }[]; tracepoints?: ({ matchings_index: number; location: number[] } | null)[] };
    out.push({
      code: j.code,
      matchings: j.matchings?.map((m) => ({ confidence: m.confidence, geometry: m.geometry, legs: m.legs.map((l) => ({ distance: l.distance })) })),
      tracepoints: j.tracepoints?.map((t) => (t ? { matchings_index: t.matchings_index, location: t.location } : null)),
    });
    console.log(r.status, j.code, c.length, 'pont');
  }
  matches.push(out);
}
writeFileSync(new URL('../../../packages/app-logic/src/fixtures/track-budapest.json', import.meta.url), `${JSON.stringify({
  source: 'OpenStreetMap nyilvános GPS-nyom (© OpenStreetMap contributors), valódi autós felvétel Budapesten; a kiesés és a visszafordulás a felvétel után került bele; a Map Matching-válaszok élőben rögzítve',
  gap: trace[gapFrom - 1] && trace[gapFrom] ? { beforeT: trace[gapFrom - 1]!.t, afterT: trace[gapFrom]!.t } : null,
  uturnT: end.t,
  uturnAt,
  samples: trace.map((p) => [p.t, Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6, p.kmh]),
  matches,
})}\n`);

const lat = trace.map((p) => p.lat);
const lon = trace.map((p) => p.lon);
const bbox = `${Math.min(...lat) - 0.002},${Math.min(...lon) - 0.002},${Math.max(...lat) + 0.002},${Math.max(...lon) + 0.002}`;
if (process.env.SKIP_ROADS) process.exit(0);
const q = `[out:json][timeout:60];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bbox});out geom;`;
const ov = (await (await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'atlagsebesseg-app (fixture)' }, body: `data=${encodeURIComponent(q)}` })).json()) as { elements: { geometry: { lat: number; lon: number }[] }[] };
writeFileSync(new URL('../../../packages/app-logic/src/fixtures/track-budapest-roads.json', import.meta.url), `${JSON.stringify({ source: 'OpenStreetMap (© OpenStreetMap contributors), Overpass, 2026-11-05', roads: ov.elements.map((e) => e.geometry.map((g) => [Math.round(g.lat * 1e6) / 1e6, Math.round(g.lon * 1e6) / 1e6])) })}\n`);
console.log('nyomat', trace.length, 'darab', parts.length, 'út', ov.elements.length);
