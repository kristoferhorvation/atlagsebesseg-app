/**
 * Franciaország – radars tronçons (vitesse moyenne).
 *
 * Hivatalos lista: data.gouv.fr „Liste des radars fixes en France” (Ministère de l'Intérieur,
 * Licence Ouverte 2.0) – a „Type de radar” = ETVM sorok. Soronként EGY pont (+ VMA), kezdő- és
 * végpont, útszám, irány, hossz nélkül. Kiegészítés ugyanattól a minisztériumtól: a radartérkép
 * (radars.securite-routiere.gouv.fr) tronçononként útszámot, irányt („X vers Y”) és hosszt ad.
 *
 * Mivel a forrás csak egy pontot ad, a kapuk az OSM `enforcement=average_speed` relációjából jönnek,
 * és CSAK akkor, ha pontosan egy reláció egyezik: útvonala ≤ 150 m-re halad el a hivatalos pont
 * mellett, a hivatalos útszámon, a hivatalos hosszal (±15%) és határral; és az iránya a hivatalos
 * „X vers Y” szerinti (a vége közelebb van Y-hoz, az eleje X-hez). Különben kimarad.
 */
import { haversineM, LocalProjection, type LatLon } from '@atlagsebesseg/core';
import { bboxAround, extractEndpoints, parseMaxspeed } from '../../src/convert';
import { RoadGraph } from '../../src/graph';
import { evaluateOfficial, type OfficialItem, type OfficialSkip } from '../../src/official';
import { roadsQuery, type OsmNode, type OsmRelation, type OsmWay } from '../../src/overpass';
import type { CountryImporter } from './context';

const DATASET_API = 'https://www.data.gouv.fr/api/1/datasets/6712583387af110196942793/';
const DATASET_PAGE = 'https://www.data.gouv.fr/fr/datasets/liste-des-radars-fixes-en-france/';
const DETAIL = (id: string) => `https://radars.securite-routiere.gouv.fr/radars/${id}?_format=json`;

export interface EtvmRow {
  id: string;
  vma: number;
  lat: number;
  lon: number;
}

/** A data.gouv CSV (latin-1, `;`, a fejlécben szóközök) ETVM-sorai. */
export function parseRadarCsv(csv: string): EtvmRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = lines[0]!.split(';').map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const [iId, iType, iVma, iLat, iLon] = [col(/^num/), col(/^type/), col(/^vma/), col(/^latitude/), col(/^longitude/)];
  return lines
    .slice(1)
    .map((l) => l.split(';').map((c) => c.trim()))
    .filter((c) => c[iType] === 'ETVM')
    .map((c) => ({ id: c[iId]!, vma: Number(c[iVma]), lat: Number(c[iLat]), lon: Number(c[iLon]) }));
}

/** "RN 57" / "RD213" / "A10" → "N57" / "D213" / "A10" (az OSM-ref alakja). */
export function frRoad(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '').replace(/^R([NDM])(?=\d)/, '$1');
}

/** Településnév összehasonlításhoz: ékezet, kötőjel, „Saint” → „ST”. */
export function normPlace(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[-'’]/g, ' ')
    .replace(/\bSAINTE\b/g, 'STE')
    .replace(/\bSAINT\b/g, 'ST')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "X vers Y" → [X, Y]; ha nem ilyen alakú (pl. „Nord vers Sud”, „PR croissant”), a hívó nem talál települést. */
export function splitDirection(s: string): [string, string] | null {
  const m = /^(.+?)\s+vers\s+(.+)$/i.exec(s.trim());
  return m ? [m[1]!.trim(), m[2]!.trim()] : null;
}

function distToLineM(p: LatLon, line: readonly LatLon[]): number {
  const proj = new LocalProjection(p);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = proj.toXY(line[i - 1]!);
    const b = proj.toXY(line[i]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

export const importFR: CountryImporter = async (ctx) => {
  const meta = JSON.parse(await ctx.fetchText(DATASET_API, 'dataset.json')) as {
    resources: { title: string; url: string; format: string; last_modified: string }[];
  };
  const csvRes = meta.resources
    .filter((r) => r.format?.toLowerCase() === 'csv' || r.url.endsWith('.csv'))
    .sort((a, b) => b.last_modified.localeCompare(a.last_modified))[0];
  if (!csvRes) throw new Error('data.gouv: nincs CSV erőforrás');
  const rows = parseRadarCsv(await ctx.fetchText(csvRes.url, 'radars.csv', { encoding: 'latin1' }));
  const date = csvRes.last_modified.slice(0, 10);
  ctx.log(`data.gouv (${date}): ${rows.length} radar tronçon (ETVM)`);

  const provenance = { name: "Ministère de l'Intérieur (data.gouv.fr)", url: DATASET_PAGE, date, locatedBy: 'koordinata' } as const;
  const items: OfficialItem[] = [];
  const skipped: OfficialSkip[] = [];

  for (const r of rows) {
    const point = { lat: r.lat, lon: r.lon };
    let detail: { radarroad?: string; radardirection?: string; radartronconkm?: string; radarplace?: string } | null = null;
    try {
      detail = JSON.parse(await ctx.fetchText(DETAIL(r.id), `detail/${r.id}.json`));
    } catch {
      detail = null;
    }
    const label = `${r.id} ${detail?.radarroad ?? ''} ${detail?.radardirection ?? ''} (${detail?.radarplace ?? ''})`.replace(/\s+/g, ' ');
    const skip = (reason: string) => skipped.push({ id: `fr-${r.id}`, label, reason });
    const lengthKm = Number((detail?.radartronconkm ?? '').replace(',', '.'));
    if (!detail?.radarroad || !lengthKm) {
      skip('a radartérkép nem ad útszámot / hosszt');
      continue;
    }
    const road = frRoad(detail.radarroad);
    const dir = splitDirection(detail.radardirection ?? '');

    // OSM-relációk a hivatalos pont körül
    const rel = await ctx.overpass(`[out:json][timeout:60];
relation["type"="enforcement"]["enforcement"="average_speed"](around:3000,${r.lat},${r.lon})->.r;
.r out body;
node(r.r);
out body;`);
    const nodes = new Map<number, OsmNode>();
    const rels: OsmRelation[] = [];
    for (const e of rel.elements) {
      if (e.type === 'node') nodes.set(e.id, e);
      else if (e.type === 'relation') rels.push(e);
    }
    const matches: { item: OfficialItem; rel: number }[] = [];
    for (const rr of rels) {
      const ep = extractEndpoints(rr, nodes);
      if (typeof ep === 'string' || !ep.ordered) continue;
      const item: OfficialItem = {
        id: `fr-${r.id}`,
        country: 'FR',
        road,
        direction: detail.radardirection?.replace(/\s+vers\s+/i, ' → ') ?? '',
        label,
        start: { lat: ep.start.lat, lon: ep.start.lon },
        end: { lat: ep.end.lat, lon: ep.end.lon },
        speedLimitKmh: r.vma,
        officialLengthM: lengthKm * 1000,
        provenance,
      };
      const graph = new RoadGraph(
        (await ctx.overpass(roadsQuery(bboxAround([item.start, item.end], 2000), { minor: true }))).elements.filter((e): e is OsmWay => e.type === 'way'),
      );
      const ev = evaluateOfficial(item, graph);
      if (!ev.ok || distToLineM(point, ev.section.geometry!) > 150) continue;
      // a reláció saját határa ne mondjon ellent a hivatalosnak
      const relLimit = parseMaxspeed(rr.tags?.maxspeed);
      if (relLimit !== null && relLimit !== r.vma) continue;
      matches.push({ item, rel: rr.id });
    }
    if (matches.length === 0) {
      skip('a forrás egy pontot ad; nincs olyan OSM-reláció, amely a ponton át, a hivatalos úton, hosszal és határral egyezne');
      continue;
    }
    if (matches.length > 1) {
      skip(`${matches.length} OSM-reláció is illeszkedik (${matches.map((m) => `r${m.rel}`).join(', ')}) – nem egyértelmű`);
      continue;
    }
    // irány a hivatalos „X vers Y” szerint
    const m = matches[0]!;
    if (!dir) {
      skip(`az irány („${detail.radardirection}”) nem településpár, a reláció iránya nem ellenőrizhető`);
      continue;
    }
    const places = await findPlaces(ctx, point, dir);
    if (!places.to) {
      skip(`a cél-település („${dir[1]}”) nem található az OSM-ben, az irány nem ellenőrizhető`);
      continue;
    }
    const towardTo = haversineM(m.item.start, places.to) - haversineM(m.item.end, places.to);
    const awayFrom = places.from ? haversineM(m.item.end, places.from) - haversineM(m.item.start, places.from) : null;
    if (towardTo < 0.3 * lengthKm * 1000 || (awayFrom !== null && awayFrom < 0)) {
      skip(`az OSM-reláció (r${m.rel}) iránya nem egyezik a hivatalos „${detail.radardirection}” iránnyal`);
      continue;
    }
    items.push(m.item);
  }
  return {
    sources: [
      { name: "Ministère de l'Intérieur (data.gouv.fr)", url: DATASET_PAGE, date, note: `${csvRes.title}; ETVM = radar tronçon` },
      { name: 'Sécurité routière – carte des radars', url: 'https://radars.securite-routiere.gouv.fr/', date: new Date().toISOString().slice(0, 10), note: 'útszám, irány, hossz tronçononként (a letöltés napja)' },
    ],
    listed: rows.length,
    items,
    skipped,
    minorRoads: true,
  };
};

/** Az „X vers Y” települései az OSM-ből (város/kisváros 150 km-en, falu 25 km-en belül), a legközelebbi. */
async function findPlaces(ctx: Parameters<CountryImporter>[0], p: LatLon, [x, y]: [string, string]): Promise<{ from: LatLon | null; to: LatLon | null }> {
  // két kisebb lekérdezés (a nyilvános Overpass a nagy körzetre 502-t ad)
  const q = (kinds: string, r: number) => `[out:json][timeout:180];
node["place"~"^(${kinds})$"]["name"](around:${r},${p.lat.toFixed(3)},${p.lon.toFixed(3)});
out body;`;
  const res = { elements: [...(await ctx.overpass(q('city|town', 150000))).elements, ...(await ctx.overpass(q('village|suburb', 25000))).elements] };
  const nodes = res.elements.filter((e): e is OsmNode => e.type === 'node' && !!e.tags?.name);
  const find = (name: string) => {
    const want = normPlace(name);
    const hits = nodes.filter((n) => normPlace(n.tags!.name!) === want).sort((a, b) => haversineM(a, p) - haversineM(b, p));
    return hits[0] ? { lat: hits[0].lat, lon: hits[0].lon } : null;
  };
  return { from: find(x), to: find(y) };
}
