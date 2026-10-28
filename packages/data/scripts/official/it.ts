/**
 * Olaszország – Tutor / SICVe.
 *
 * Hivatalos lista: Polizia di Stato (https://www.poliziadistato.it/articolo/tutor, 2026-08; a PDF
 * „aggiornato al 27 maggio 2026”: 204 tratta). Kapuhely (km-szelvény) a listában nincs; az
 * Autostrade per l'Italia (ASPI) „Tratte autostradali con sistema Tutor” táblázata adja a
 * km-szelvényeket a saját pályáin (178 tratta, mind szerepel a Polizia-listán is).
 * A km → koordináta az OSM `highway=milestone` csomópontjaiból: két szomszédos (≤ 3 km), egymással
 * konzisztens km-kő közti interpoláció; ha ilyen nincs, lineáris vetítés az autópálya OSM-vonalán két
 * közrefogó km-kő között (≤ 30 km), de csak ha a köztük futó útvonal hossza a km-különbséggel
 * ±1,5%-on (+100 m) belül egyezik – különben kimarad.
 * A Polizia-lista nem-ASPI trattáihoz nincs km-adat → kimaradnak (manual/it-polizia-nem-aspi.json).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineM, type LatLon } from '@atlagsebesseg/core';
import { bboxAround } from '../../src/convert';
import { RoadGraph } from '../../src/graph';
import type { OfficialItem, OfficialSkip } from '../../src/official';
import type { OsmNode, OsmWay } from '../../src/overpass';
import { routeBetween } from '../../src/routeBetween';
import type { CountryImporter, ImportContext } from './context';

const here = dirname(fileURLToPath(import.meta.url));
const ASPI = 'https://www.autostrade.it/it/tecnologia-sicurezza/sicurezza/il-tutor';
const POLIZIA = 'https://www.poliziadistato.it/articolo/tutor';
const POLIZIA_TOTAL = 204;

export interface AspiRow {
  autostrada: string;
  tratta: string;
  inizio: string;
  kmInizio: number;
  fine: string;
  kmFine: number;
}

const clean = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** "12,05" → 12.05; "153,400" → 153.4 (tizedesvessző). */
export const parseKm = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/** Az ASPI-oldal Tutor-táblázata (`<div class="tratto row">` blokkok, soronként 4 cella). */
export function parseAspi(html: string): AspiRow[] {
  const start = html.indexOf('Tratte autostradali con sistema Tutor');
  const body = start >= 0 ? html.slice(start) : html;
  const out: AspiRow[] = [];
  for (const block of body.split('<div class="tratto row">').slice(1)) {
    const head = /<span class="trat">(.*?)<\/span>(.*?)<\/div>/s.exec(block);
    if (!head) continue;
    const autostrada = clean(head[1]!);
    const tratta = clean(head[2]!);
    for (const row of block.matchAll(/<div class="row intwr[^"]*">((?:<div class="[^"]*">.*?<\/div>){4})/gs)) {
      const cells = [...row[1]!.matchAll(/<div class="[^"]*">(.*?)<\/div>/gs)].map((m) => clean(m[1]!));
      const [inizio, kmI, fine, kmF] = cells as [string, string, string, string];
      out.push({ autostrada, tratta, inizio, kmInizio: parseKm(kmI), fine, kmFine: parseKm(kmF) });
    }
  }
  return out;
}

export interface Milestone extends LatLon {
  km: number;
}

/** Km-kövek az OSM-ből: numerikus `distance`, és ha van `ref`, az az adott autópálya. */
export function milestonesFrom(nodes: OsmNode[], road: string): Milestone[] {
  const out: Milestone[] = [];
  for (const n of nodes) {
    const t = n.tags ?? {};
    const km = Number((t.distance ?? '').replace(',', '.'));
    if (!t.distance || !Number.isFinite(km)) continue;
    if (t.ref && !t.ref.split(';').some((r) => r.replace(/\s/g, '').toUpperCase() === road.toUpperCase())) continue;
    out.push({ lat: n.lat, lon: n.lon, km });
  }
  return out;
}

/**
 * Km-szelvény → hely: minden olyan km-kőpárból, amely közrefogja (≤ 3 km-es köz) és a légvonalbeli
 * távolsága illik a km-különbséghez (0,7–1,3×), lineáris interpoláció. Ha a jelöltek 400 m-nél
 * jobban szórnak (pl. két pályatest közti keveredés helyett más szakasz), nem biztos → hibaüzenet.
 */
export function locateKm(ms: readonly Milestone[], km: number): LatLon | string {
  const cands: LatLon[] = [];
  for (const a of ms) {
    if (a.km === km) cands.push(a);
    if (a.km > km) continue;
    for (const b of ms) {
      const span = b.km - a.km;
      if (b.km < km || span <= 0 || span > 3 || a.km === km) continue;
      const d = haversineM(a, b);
      if (d < span * 700 || d > span * 1300) continue;
      const k = (km - a.km) / span;
      cands.push({ lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k });
    }
  }
  if (!cands.length) return `nincs közrefogó, konzisztens km-kő a km ${km} körül (OSM)`;
  const c = { lat: cands.reduce((s, p) => s + p.lat, 0) / cands.length, lon: cands.reduce((s, p) => s + p.lon, 0) / cands.length };
  const spread = Math.max(...cands.map((p) => haversineM(p, c)));
  if (spread > 400) return `a km ${km} km-kövei ellentmondanak egymásnak (${Math.round(spread)} m szórás)`;
  return c;
}

/** A vonal mentén `d` méterre lévő pont. */
export function pointAlong(line: readonly LatLon[], d: number): LatLon {
  let left = Math.max(0, d);
  for (let i = 1; i < line.length; i++) {
    const seg = haversineM(line[i - 1]!, line[i]!);
    if (left <= seg && seg > 0) {
      const k = left / seg;
      return { lat: line[i - 1]!.lat + (line[i]!.lat - line[i - 1]!.lat) * k, lon: line[i - 1]!.lon + (line[i]!.lon - line[i - 1]!.lon) * k };
    }
    left -= seg;
  }
  return line[line.length - 1]!;
}

/** Lineáris vetítés az út vonalán két közrefogó km-kő között (≤ 30 km), útvonalhossz-ellenőrzéssel. */
async function locateKmAlongRoad(ctx: ImportContext, road: string, ms: readonly Milestone[], km: number): Promise<LatLon | string> {
  const below = ms.filter((m) => m.km <= km).sort((a, b) => b.km - a.km).slice(0, 4);
  const above = ms.filter((m) => m.km >= km).sort((a, b) => a.km - b.km).slice(0, 4);
  for (const a of below) {
    for (const b of above) {
      const span = b.km - a.km;
      if (span <= 0 || span > 30) continue;
      const box = bboxAround([a, b], 2000);
      const bbox = [box.south, box.west, box.north, box.east].map((x) => x.toFixed(4)).join(',');
      const res = await ctx.overpass(`[out:json][timeout:120];
way["highway"="motorway"]["ref"~"^${road}([;]|$)"](${bbox});
out body geom;`);
      const graph = new RoadGraph(res.elements.filter((e): e is OsmWay => e.type === 'way'));
      for (const [from, to, reversed] of [[a, b, false], [b, a, true]] as const) {
        const r = routeBetween(graph, from, to, { snapRadiusM: 60, maxDetourFactor: 1.3 });
        if (typeof r === 'string') continue;
        if (Math.abs(r.lengthM - span * 1000) > 0.015 * span * 1000 + 100) continue;
        const frac = (km - a.km) / span;
        return pointAlong(r.geometry, (reversed ? 1 - frac : frac) * r.lengthM);
      }
    }
  }
  return `nincs közrefogó km-kőpár, amely között az út hossza a km-különbséggel egyezne (km ${km})`;
}

const place = (s: string) => s.replace(/\s*Dir\.?\s*(Nord|Sud|Est|Ovest)\s*$/i, '').trim();

export const importIT: CountryImporter = async (ctx) => {
  const rows = parseAspi(await ctx.fetchText(ASPI, 'aspi-il-tutor.html'));
  ctx.log(`ASPI: ${rows.length} tratta km-szelvénnyel`);
  const nonAspi = JSON.parse(await readFile(join(here, '..', '..', 'manual', 'it-polizia-nem-aspi.json'), 'utf8')) as {
    tratte: { autostrada: string; da: string; a: string }[];
  };

  const provenance = { name: 'Polizia di Stato', url: POLIZIA, date: '2026-08', locatedBy: 'km_szelveny' } as const;
  const skipped: OfficialSkip[] = nonAspi.tratte.map((t, i) => ({
    id: `it-ps-nonaspi-${i + 1}`,
    label: `${t.autostrada} ${t.da} → ${t.a}`,
    reason: 'nem ASPI-pálya: a hivatalos listán nincs km-szelvény vagy koordináta, a kapuk helye nem azonosítható',
  }));
  const items: OfficialItem[] = [];
  const milestones = new Map<string, Milestone[]>();
  const projectedIds = new Set<string>();

  for (const [i, r] of rows.entries()) {
    const id = `it-aspi-${r.autostrada.toLowerCase()}-${String(Math.round(r.kmInizio * 1000)).padStart(6, '0')}-${r.kmFine > r.kmInizio ? 'c' : 'd'}`;
    const label = `${r.autostrada} ${r.inizio} (km ${r.kmInizio}) → ${r.fine} (km ${r.kmFine})`;
    if (/variante|diramazione/i.test(r.tratta)) {
      skipped.push({ id, label: `${label} [${r.tratta}]`, reason: 'saját km-számozású ág (variante/diramazione): az autópálya km-köveihez nem illeszthető biztosan' });
      continue;
    }
    if (!Number.isFinite(r.kmInizio) || !Number.isFinite(r.kmFine)) {
      skipped.push({ id: `it-aspi-${i}`, label, reason: 'hiányzó / értelmezhetetlen km-szelvény' });
      continue;
    }
    let ms = milestones.get(r.autostrada);
    if (!ms) {
      const res = await ctx.overpass(`[out:json][timeout:240];
area["ISO3166-1"="IT"][admin_level=2]->.c;
way["highway"="motorway"]["ref"~"^${r.autostrada}([;]|$)"](area.c)->.w;
node(around.w:60)["highway"="milestone"];
out body;`);
      ms = milestonesFrom(res.elements.filter((e): e is OsmNode => e.type === 'node'), r.autostrada);
      milestones.set(r.autostrada, ms);
      ctx.log(`${r.autostrada}: ${ms.length} km-kő`);
    }
    let start = locateKm(ms, r.kmInizio);
    let end = locateKm(ms, r.kmFine);
    let projected = false;
    if (typeof start === 'string' && !/ellentmondanak/.test(start)) {
      start = await locateKmAlongRoad(ctx, r.autostrada, ms, r.kmInizio);
      projected = true;
    }
    if (typeof end === 'string' && !/ellentmondanak/.test(end)) {
      end = await locateKmAlongRoad(ctx, r.autostrada, ms, r.kmFine);
      projected = true;
    }
    if (typeof start === 'string' || typeof end === 'string') {
      skipped.push({ id, label, reason: typeof start === 'string' ? start : (end as string) });
      continue;
    }
    if (projected) projectedIds.add(id);
    items.push({
      id,
      country: 'IT',
      road: r.autostrada,
      direction: `${place(r.inizio)} → ${place(r.fine)}`,
      label,
      start,
      end,
      speedLimitKmh: null,
      officialLengthM: Math.abs(r.kmFine - r.kmInizio) * 1000,
      provenance,
    });
  }
  return {
    sources: [
      { name: 'Polizia di Stato', url: POLIZIA, date: '2026-08', note: 'hivatalos lista (PDF, aggiornato al 27 maggio 2026): 204 tratta' },
      { name: "Autostrade per l'Italia", url: ASPI, date: new Date().toISOString().slice(0, 10), note: 'km-szelvények az ASPI-pályákon (178 tratta); az oldalon nincs dátum, ez a letöltés napja' },
    ],
    listed: POLIZIA_TOTAL,
    items,
    notes: [...projectedIds].map((id) => ({ id, note: 'kapu lineáris vetítéssel az út OSM-vonalán két km-kő között (hossz-ellenőrzéssel)' })),
    skipped,
    snapRadiusM: 150,
  };
};
