/**
 * A tervezett mérések lekérése (A7): a police.hu közlekedésrendészeti hírei közül azok, amelyek
 * előre megnevezett helyszíneket tartalmaznak (szövegben vagy PDF-mellékletben), az OSM-re
 * illesztve. A külvilág (HTTP, PDF, Overpass, adatbázis) a `deps`-ben – a tesztben hamisítható,
 * az edge functionben fetch + unpdf, helyben ugyanaz Node-ból.
 */
import type { LatLon } from '@atlagsebesseg/core';
import type { OverpassResponse } from '../overpass';
import {
  areaZone,
  bboxOf,
  countyWaysQuery,
  locateByKm,
  locateInSettlement,
  parseSettlements,
  roadMilestonesQuery,
  settlementsQuery,
  settlementSubset,
  type AdminArea,
  type CountyAreas,
  type LocateResult,
  type ZoneGeometry,
  zoneBbox,
} from './locate';
import {
  clean,
  COUNTIES,
  countyFromText,
  isCandidate,
  isHeaderLine,
  parseArticle,
  parseListing,
  parseLocationLine,
  parsePeriod,
  POLICE_TRAFFIC_LISTING,
  type Article,
  type Period,
  type PlannedLine,
} from './parse';

/** A `planned_checks` tábla egy sora. */
export interface PlannedCheckRow {
  id: string;
  country: 'HU';
  county: string;
  settlement: string | null;
  road_ref: string | null;
  description: string;
  /** Vonal (út / utca / kereszteződés) vagy zóna (egész település: a közigazgatási határ sokszöge). */
  geometry:
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'MultiLineString'; coordinates: [number, number][][] }
    | ZoneGeometry;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
  speed_limit_kmh: number;
  limit_source: 'osm' | 'kresz_default';
  valid_from: string;
  valid_to: string;
  time_window: string | null;
  source_url: string;
  fetched_at: string;
}

export interface PlannedStore {
  upsert(rows: PlannedCheckRow[]): Promise<void>;
  /** A lejárt sorok törlése; a törölt sorok száma. */
  deleteExpired(nowIso: string): Promise<number>;
  /** Egy forrás (cikk/melléklet) régi sorai, amelyek az új feldolgozásban már nincsenek. */
  deleteStale(sourceUrl: string, keepIds: readonly string[]): Promise<number>;
  logRun(ok: boolean, summary: RunSummary, error?: string): Promise<void>;
}

export interface PlannedDeps {
  fetchText(url: string): Promise<string>;
  fetchBytes(url: string): Promise<Uint8Array>;
  pdfText(bytes: Uint8Array): Promise<string>;
  overpass(query: string): Promise<OverpassResponse>;
  /** Nélküle száraz futás (nem ír). */
  store?: PlannedStore;
  now(): Date;
}

export interface RunOptions {
  listingUrl?: string;
  /** A hírlista helyett ezek a cikkek (kézi futtatás, teszt). */
  articleUrls?: string[];
  /** Ennél régebbi hírt nem nézünk (nap). */
  maxAgeDays?: number;
  /** Ennyi idő után nem indít új Overpass-lekérést (edge function időkorlát); a maradék a következő futásé. */
  budgetMs?: number;
}

export interface Skip {
  line: string;
  reason: string;
}

export interface CountySummary {
  rows: number;
  skipped: Skip[];
}

export interface ArticleSummary {
  url: string;
  title: string;
  /** feldolgozva | nincs dátum | lejárt | nincs helyszín | hiba */
  status: string;
  period?: string;
  rows: number;
  skipped: number;
}

export interface RunSummary {
  listingItems: number;
  candidates: number;
  articles: ArticleSummary[];
  counties: Record<string, CountySummary>;
  rows: number;
  /** A `rows`-ból ennyi zóna-típusú (egész település). */
  zones: number;
  skipped: number;
  deletedExpired: number;
  deletedStale: number;
  /** Az időkeret miatt feldolgozatlan helyszín-sorok (a következő futás folytatja). */
  remaining: number;
  /** Szerkezeti gond (pl. helyszín-melléklet, amiből 0 sor jött). */
  errors: string[];
}

/** Hasonló sor-azonosító minden futásnál (forrás + a sor szövege + km-index). */
export function rowId(sourceUrl: string, raw: string, part = 0): string {
  return `hu-${cyrb53(`${sourceUrl}|${raw}|${part}`).toString(16).padStart(14, '0')}`;
}

function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Helyszín-sornak látszik-e (lista elem): ismert településsel vagy útszámmal kezdődik, és nem mondat. */
export function looksLikeLocation(line: string, settlements: readonly string[]): boolean {
  const l = clean(line);
  if (!l || l.length > 160 || isHeaderLine(l)) return false;
  if (/^(M\d{1,2}|\d{1,5})(\s*-\s*(as|es|ös|os|ás|s)\b|\.)?\s*(sz\.|számú|számfú)?\s*(főút|út|autópálya|autóút)\b/i.test(l)) return true;
  const lower = l.toLowerCase();
  return settlements.some((s) => lower === s.toLowerCase() || [' ', ',', '-'].some((sep) => lower.startsWith(`${s.toLowerCase()}${sep}`)));
}

interface SourcedLine {
  text: string;
  county: string | null;
  sourceUrl: string;
  /** Helyszín-táblázatból (PDF) jön: minden nem-fejléc sora helyszín; a cikk folyószövegéből csak a listaszerű sor. */
  fromList: boolean;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const toCoords = (l: LatLon[]) => l.map((p) => [round6(p.lon), round6(p.lat)] as [number, number]);

/**
 * Egy futás. Hibát dob, ha a hírlista üres (a police.hu szerkezete változott) vagy nem érhető el;
 * a cikkenkénti hibák a `summary.errors`-ba kerülnek.
 */
export async function runPlannedChecks(deps: PlannedDeps, opts: RunOptions = {}): Promise<RunSummary> {
  const started = Date.now();
  const now = deps.now();
  const budget = opts.budgetMs ?? Infinity;
  const summary: RunSummary = { listingItems: 0, candidates: 0, articles: [], counties: {}, rows: 0, zones: 0, skipped: 0, deletedExpired: 0, deletedStale: 0, remaining: 0, errors: [] };
  const county = (c: string) => (summary.counties[c] ??= { rows: 0, skipped: [] });

  // 1. jelöltek
  let urls: string[];
  if (opts.articleUrls?.length) {
    urls = opts.articleUrls;
  } else {
    const listing = parseListing(await deps.fetchText(opts.listingUrl ?? POLICE_TRAFFIC_LISTING));
    summary.listingItems = listing.length;
    if (!listing.length) throw new Error('A police.hu közlekedésrendészeti hírlistája 0 hírt adott – megváltozott az oldal szerkezete?');
    const minDate = new Date(now.getTime() - (opts.maxAgeDays ?? 21) * 86400_000).toISOString().slice(0, 10);
    urls = listing.filter((i) => i.published.slice(0, 10) >= minDate && isCandidate(i.title, i.lead)).map((i) => i.url);
  }
  summary.candidates = urls.length;

  // a megyék településlistája és a település-utak lekérése egyszer
  const areasCache = new Map<string, Promise<CountyAreas | null>>();
  const areasOf = (c: string) => {
    if (!areasCache.has(c)) {
      const osmName = COUNTIES.find((x) => x.name === c)!.osm;
      areasCache.set(c, deps.overpass(settlementsQuery(osmName)).then((r) => parseSettlements(r, osmName)));
    }
    return areasCache.get(c)!;
  };
  const outOfTime = () => Date.now() - started > budget;

  const rows: PlannedCheckRow[] = [];
  const processedSources = new Map<string, string[]>();

  for (const url of urls) {
    const art: ArticleSummary = { url, title: '', status: 'feldolgozva', rows: 0, skipped: 0 };
    summary.articles.push(art);
    let article: Article;
    try {
      article = parseArticle(await deps.fetchText(url), url);
    } catch (e) {
      art.status = 'hiba';
      summary.errors.push(`${url}: ${(e as Error).message}`);
      continue;
    }
    art.title = article.title;
    const period = parsePeriod([article.title, article.lead, ...article.body].join(' '), article.published);
    if (!period) {
      art.status = 'nincs dátum';
      continue;
    }
    art.period = `${period.firstDay} – ${period.lastDay}${period.timeWindow ? ` (${period.timeWindow})` : ''}`;
    if (period.validTo <= now) {
      art.status = 'lejárt';
      continue;
    }

    // 2. helyszín-sorok: a cikk szövegéből és a PDF-mellékletekből
    const articleCounty = countyFromText(article.source);
    const lines: SourcedLine[] = article.body.map((text) => ({ text, county: articleCounty, sourceUrl: url, fromList: false }));
    for (const a of article.attachments) {
      try {
        const text = await deps.pdfText(await deps.fetchBytes(a.url));
        const pdfLines = text.split('\n').map(clean).filter(Boolean);
        const c = countyFromText(a.name) ?? countyFromText(pdfLines.slice(0, 3).join(' ')) ?? articleCounty;
        const before = lines.length;
        for (const t of pdfLines) lines.push({ text: t, county: c, sourceUrl: a.url, fromList: true });
        if (/helyszín/i.test(a.name) && lines.length === before) summary.errors.push(`${a.url}: a helyszín-mellékletből 0 sor jött`);
      } catch (e) {
        summary.errors.push(`${a.url}: ${(e as Error).message}`);
      }
    }

    // 3. értelmezés megyénként (a település a megye településlistájából)
    const parsed: { line: PlannedLine; sourceUrl: string }[] = [];
    for (const l of lines) {
      if (!l.county) continue;
      const areas = await areasOf(l.county);
      if (!areas) {
        summary.errors.push(`${l.county}: a megye nem található az OSM-ben`);
        continue;
      }
      const names = l.county === 'Budapest' ? ['Budapest'] : [...areas.areas.keys()];
      if (l.fromList ? isHeaderLine(l.text) : !looksLikeLocation(l.text, names)) continue;
      parsed.push({ line: parseLocationLine(l.text, l.county, names), sourceUrl: l.sourceUrl });
    }
    if (!parsed.length) {
      art.status = 'nincs helyszín';
      continue;
    }
    for (const p of parsed) if (!processedSources.has(p.sourceUrl)) processedSources.set(p.sourceUrl, []);

    // 4. helymeghatározás: megyénként egy út-lekérés (a megye összes utcájára / útszámára), a
    // település-határra vágás helyben; útszám + km-nél utanként egy lekérés a km-kövekkel
    const groups = new Map<string, { area: AdminArea | null; items: typeof parsed }>();
    for (const p of parsed) {
      const { line } = p;
      let key: string;
      let area: AdminArea | null = null;
      if (line.kind === 'road_km') key = `km:${line.county}:${line.road}`;
      else if (line.kind === 'road' || line.kind === 'street' || line.kind === 'junction' || (line.kind === 'settlement_only' && line.zone)) {
        const areas = (await areasOf(line.county))!;
        const name = line.settlement === 'Budapest' ? line.district : line.settlement;
        area = name ? (areas.areas.get(name) ?? null) : null;
        key = `s:${line.county}:${name ?? '?'}`;
      } else key = 'skip';
      const g = groups.get(key) ?? { area, items: [] };
      g.items.push(p);
      groups.set(key, g);
    }

    const skip = (p: { line: PlannedLine }, reason: string) => {
      county(p.line.county).skipped.push({ line: p.line.raw, reason });
      summary.skipped++;
      art.skipped++;
    };

    const countyWays = new Map<string, Promise<OverpassResponse>>();
    const waysOf = async (c: string) => {
      if (!countyWays.has(c)) {
        const items = parsed.filter((p) => p.line.county === c && p.line.kind !== 'road_km');
        const streets = items.flatMap((p) => p.line.streets);
        const roads = [...new Set(items.map((p) => p.line.road).filter((r): r is string => !!r))];
        countyWays.set(c, deps.overpass(countyWaysQuery((await areasOf(c))!.county, streets, roads)));
      }
      return countyWays.get(c)!;
    };

    for (const [key, g] of groups) {
      if (key === 'skip') {
        for (const p of g.items) skip(p, p.line.reason ?? 'nem értelmezhető helyszín');
        continue;
      }
      if (outOfTime()) {
        summary.remaining += g.items.length;
        continue;
      }
      let results: { p: (typeof parsed)[number]; r: LocateResult | ZoneResult; part: number }[] = [];
      try {
        if (key.startsWith('km:')) {
          const first = g.items[0]!.line;
          const areas = (await areasOf(first.county))!;
          const res = await deps.overpass(roadMilestonesQuery(areas.county, first.road!));
          results = g.items.flatMap((p) => p.line.km.map((km, part) => ({ p, r: locateByKm(p.line, km, res), part })));
        } else if (!g.area) {
          const l = g.items[0]!.line;
          const why = l.settlement === 'Budapest' && !l.district ? 'Budapesten kerület nélkül' : `a település („${l.settlement}”) nincs meg az OSM-ben`;
          results = g.items.map((p) => ({ p, r: { ok: false, reason: why }, part: 0 }));
        } else {
          const area = g.area;
          // zóna: csak a határ kell, az utak lekérése (megyénként egy, nagy) kimarad
          const res = g.items.some((p) => !p.line.zone) ? settlementSubset(await waysOf(g.items[0]!.line.county), area) : null;
          results = g.items.map((p) => ({
            p,
            r: p.line.zone ? locateZone(area) : locateInSettlement(p.line, res!),
            part: 0,
          }));
        }
      } catch (e) {
        for (const p of g.items) skip(p, `Overpass-hiba: ${(e as Error).message.slice(0, 120)}`);
        continue;
      }
      for (const { p, r, part } of results) {
        if (!r.ok) {
          skip(p, r.reason);
          continue;
        }
        const row = 'zone' in r ? toZoneRow(p.line, r.zone, period, p.sourceUrl, part, now) : toRow(p.line, r.located, period, p.sourceUrl, part, now);
        // ugyanaz a sor kétszer („Gyula”, „Gyula”), vagy ugyanaz a zóna másképp megfogalmazva („Gyula mozgó
        // ellenőrzés”): egyszer kerül be (az upsert egy kötegben nem érintheti kétszer ugyanazt az azonosítót)
        const isZone = (x: PlannedCheckRow) => x.geometry.type === 'Polygon' || x.geometry.type === 'MultiPolygon';
        const same = rows.find((x) => x.id === row.id || (isZone(row) && isZone(x) && x.settlement === row.settlement && x.source_url === row.source_url));
        if (same) {
          const kept = processedSources.get(p.sourceUrl)!;
          if (!kept.includes(same.id)) kept.push(same.id);
          continue;
        }
        rows.push(row);
        processedSources.get(p.sourceUrl)!.push(row.id);
        county(p.line.county).rows++;
        art.rows++;
        summary.rows++;
        if (isZone(row)) summary.zones++;
      }
    }
  }

  // 5. írás: upsert, a forrás régi sorai (csak ha a forrás teljesen feldolgozva), lejártak
  if (deps.store) {
    if (rows.length) for (let i = 0; i < rows.length; i += 200) await deps.store.upsert(rows.slice(i, i + 200));
    if (!summary.remaining) for (const [src, ids] of processedSources) summary.deletedStale += await deps.store.deleteStale(src, ids);
    summary.deletedExpired = await deps.store.deleteExpired(now.toISOString());
  }
  return summary;
}

/** Egész településre szóló sor eredménye: a közigazgatási határ. */
type ZoneResult = { ok: true; zone: ZoneGeometry } | { ok: false; reason: string };

function locateZone(area: AdminArea): ZoneResult {
  const zone = areaZone(area);
  return zone ? { ok: true, zone } : { ok: false, reason: `a(z) ${area.name} közigazgatási határa nincs meg az OSM-ben` };
}

/** KRESZ-alapérték a zónához: nincs vonal, amiből sebességhatár jönne, a sáv nem is mutatja – lakott területi 50. */
const ZONE_LIMIT_KMH = 50;

function toZoneRow(line: PlannedLine, zone: ZoneGeometry, period: Period, sourceUrl: string, part: number, now: Date): PlannedCheckRow {
  const bb = zoneBbox(zone);
  return {
    id: rowId(sourceUrl, line.raw, part),
    country: 'HU',
    county: line.county,
    settlement: line.district ? `Budapest ${line.district}` : line.settlement,
    road_ref: null,
    description: line.raw.slice(0, 500),
    geometry: zone,
    min_lat: round6(bb.minLat),
    min_lng: round6(bb.minLng),
    max_lat: round6(bb.maxLat),
    max_lng: round6(bb.maxLng),
    speed_limit_kmh: ZONE_LIMIT_KMH,
    limit_source: 'kresz_default',
    valid_from: period.validFrom.toISOString(),
    valid_to: period.validTo.toISOString(),
    time_window: period.timeWindow,
    source_url: sourceUrl,
    fetched_at: now.toISOString(),
  };
}

function toRow(
  line: PlannedLine,
  located: { lines: LatLon[][]; speedLimitKmh: number; limitSource: 'osm' | 'kresz_default' },
  period: Period,
  sourceUrl: string,
  part: number,
  now: Date,
): PlannedCheckRow {
  const bb = bboxOf(located.lines);
  const geometry: PlannedCheckRow['geometry'] =
    located.lines.length === 1
      ? { type: 'LineString', coordinates: toCoords(located.lines[0]!) }
      : { type: 'MultiLineString', coordinates: located.lines.map(toCoords) };
  return {
    id: rowId(sourceUrl, line.raw, part),
    country: 'HU',
    county: line.county,
    settlement: line.district ? `Budapest ${line.district}` : line.settlement,
    road_ref: line.road ?? (line.streets.length ? line.streets.join(' – ') : null),
    description: line.raw.slice(0, 500),
    geometry,
    min_lat: round6(bb.minLat),
    min_lng: round6(bb.minLng),
    max_lat: round6(bb.maxLat),
    max_lng: round6(bb.maxLng),
    speed_limit_kmh: located.speedLimitKmh,
    limit_source: located.limitSource,
    valid_from: period.validFrom.toISOString(),
    valid_to: period.validTo.toISOString(),
    time_window: period.timeWindow,
    source_url: sourceUrl,
    fetched_at: now.toISOString(),
  };
}
