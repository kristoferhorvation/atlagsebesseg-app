/**
 * Fix kamerák (A7). Magyarország: az ORFK 2015-ben közzétett fix VÉDA-pontjai (Zsaru Magazin
 * 2015/48, police.hu) összevetve az OSM `highway=speed_camera` csomópontjaival.
 * Csak biztos adat: a VÉDA-pont csak akkor kerül be, ha az OSM-ben is van kamera 300 m-en belül.
 */
import { haversineM, type LatLon } from '@atlagsebesseg/core';
import type { OsmNode } from './overpass';
import { parseMaxspeed } from './convert';

export type CameraType = 'speed' | 'red_light' | 'complex' | 'section_gate';

/** Egy fix kamera – a `cameras` tábla sora. */
export interface CameraRow {
  id: string;
  country: string;
  type: CameraType;
  lat: number;
  lng: number;
  heading: number | null;
  road: string;
  speed_limit_kmh: number | null;
  source: string;
  source_url: string;
  source_date: string;
  verified: boolean;
}

/** A 2015-ös lista egy sora. */
export interface VedaPoint extends LatLon {
  /** Sorszám a listában (1-től), az azonosító alapja. */
  n: number;
  county: string;
  settlement: string;
  /** belterület | külterület | gyorsforg. */
  placement: string;
  road: string;
  /** Pályatest gyorsforgalmi úton (bal / jobb), ha a lista megadja. */
  side: 'bal' | 'jobb' | null;
  /** Km-szelvény a forrás írásmódjában, pl. "60+090". */
  km: string;
  /** A forrás sora szó szerint (a kihagyási listához). */
  raw: string;
}

export const VEDA_SOURCE = {
  name: 'ORFK – fix VÉDA-helyszínek (Zsaru Magazin 2015/48)',
  url: 'https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/zsaru-magazin/veda-fix-kamerak-listaja',
  pdfs: ['https://www.police.hu/sites/default/files/lista1.pdf', 'https://www.police.hu/sites/default/files/lista2.pdf'],
  date: '2015-11',
} as const;

/** A VÉDA-pont és az OSM-kamera legfeljebb ekkora távolságra lehet egymástól. */
export const VEDA_MATCH_M = 300;

/** A magazin betűkészlete az ő/ű betűt õ/û-ként adja vissza. */
export function fixHungarian(s: string): string {
  return s.replace(/õ/g, 'ő').replace(/Õ/g, 'Ő').replace(/û/g, 'ű').replace(/Û/g, 'Ű');
}

/** A kiemelt (duplázott betűs) megyecím: „BBaarraannyyaa mmeeggyyee” → „Baranya megye”; egyébként `null`. */
export function undoubleHeading(line: string): string | null {
  const s = line.trim();
  if (s.length < 4) return null;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ') {
      out += ' ';
      i += /\s/.test(s[i + 1] ?? '') ? 2 : 1;
      continue;
    }
    if (s[i + 1] !== c) return null;
    out += c;
    i += 2;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const VEDA_LINE =
  /^(.+?)\s+(belterület|külterület|gyorsforg\.)\s+(M?\d+(?:\s*[–-]\s*M\d+)?)\s+(?:(bal|jobb)\s+)?(\d+\s*\+\s*\d+)\s+(\d{2}[.,]\d+)\s+(\d{2}[.,]\d+)\s*$/;

const num = (s: string) => Number(s.replace(',', '.'));

/**
 * A 2015-ös lista PDF-szövegéből (soronként) a pontok. A megyecímek a duplázott betűs sorok;
 * minden más sor, ami nem illik a mintára (fejléc, bevezető), kimarad.
 */
export function parseVedaList(text: string): VedaPoint[] {
  const out: VedaPoint[] = [];
  let county = '';
  for (const rawLine of fixHungarian(text).split('\n')) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const heading = undoubleHeading(line);
    if (heading && /megye$|^Budapest$/.test(heading)) {
      county = heading.replace(/ megye$/, '');
      continue;
    }
    const m = VEDA_LINE.exec(line);
    if (!m) continue;
    const lat = num(m[6]!);
    const lon = num(m[7]!);
    if (!(lat > 45.5 && lat < 48.7 && lon > 16 && lon < 23)) continue;
    out.push({
      n: out.length + 1,
      county,
      settlement: m[1]!.replace(/\s+/g, ' ').trim(),
      placement: m[2]!,
      road: m[3]!.replace(/\s+/g, '').replace('-', '–'),
      side: (m[4] as 'bal' | 'jobb' | undefined) ?? null,
      km: m[5]!.replace(/\s+/g, ''),
      lat,
      lon,
      raw: line,
    });
  }
  return out;
}

/** OSM-irány (`direction`/`camera:direction` fokban vagy égtájjal) → fok; egyéb (forward, both…) → null. */
export function parseDirection(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toUpperCase();
  const card: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  if (s in card) return card[s]!;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const d = Math.round(Number(s)) % 360;
  return d;
}

/** OSM `highway=speed_camera` csomópont → sima sebességmérő (nem ellenőrzött). */
export function osmCameraRow(node: OsmNode, country: string, fetchedDate: string): CameraRow {
  const t = node.tags ?? {};
  const limit = parseMaxspeed(t.maxspeed);
  return {
    id: `osm-node-${node.id}`,
    country,
    type: 'speed',
    lat: round7(node.lat),
    lng: round7(node.lon),
    heading: parseDirection(t.direction ?? t['camera:direction']),
    road: t.ref ?? '',
    speed_limit_kmh: limit !== null && limit >= 5 && limit <= 250 ? Math.round(limit) : null,
    source: 'OpenStreetMap',
    source_url: `https://www.openstreetmap.org/node/${node.id}`,
    source_date: fetchedDate,
    verified: false,
  };
}

export interface CameraSkip {
  point: VedaPoint;
  reason: string;
  /** A legközelebbi OSM-kamera távolsága (m), ha van. */
  nearestM: number | null;
}

export interface CameraMerge {
  rows: CameraRow[];
  /** A VÉDA-pontok, amelyekhez nincs OSM-kamera 300 m-en belül – nem kerülnek be. */
  skipped: CameraSkip[];
  /** VÉDA-pont ↔ OSM-csomópont párok (ellenőrzéshez). */
  matches: { veda: number; osm: number; distanceM: number }[];
}

/**
 * Egyesítés: VÉDA-pont + OSM-kamera 300 m-en belül → `complex`, ellenőrzött (a hivatalos
 * koordinátával; az irány és a határ az OSM-ből, ha ott megvan); csak OSM → `speed`, nem
 * ellenőrzött; csak a 2015-ös listában → kimarad (listázva). Egy OSM-kamera több VÉDA-pontot
 * is igazolhat (a lista két pályatestes pontjai néha egy OSM-csomóponthoz esnek), és ilyenkor nem
 * kerül be külön OSM-sorként.
 */
export function mergeCameras(veda: readonly VedaPoint[], osm: readonly OsmNode[], fetchedDate: string): CameraMerge {
  const rows: CameraRow[] = [];
  const skipped: CameraSkip[] = [];
  const matches: CameraMerge['matches'] = [];
  const used = new Set<number>();
  for (const p of veda) {
    let best: OsmNode | null = null;
    let bestM = Infinity;
    for (const n of osm) {
      const d = haversineM(p, n);
      if (d < bestM) [best, bestM] = [n, d];
    }
    if (!best || bestM > VEDA_MATCH_M) {
      skipped.push({ point: p, reason: `nincs OSM-kamera ${VEDA_MATCH_M} m-en belül`, nearestM: best ? Math.round(bestM) : null });
      continue;
    }
    used.add(best.id);
    matches.push({ veda: p.n, osm: best.id, distanceM: Math.round(bestM) });
    const fromOsm = osmCameraRow(best, 'HU', fetchedDate);
    rows.push({
      id: `hu-veda-2015-${String(p.n).padStart(3, '0')}`,
      country: 'HU',
      type: 'complex',
      lat: round7(p.lat),
      lng: round7(p.lon),
      heading: fromOsm.heading,
      road: p.road,
      speed_limit_kmh: fromOsm.speed_limit_kmh,
      source: `${VEDA_SOURCE.name}; OSM node ${best.id}`,
      source_url: VEDA_SOURCE.url,
      source_date: VEDA_SOURCE.date,
      verified: true,
    });
  }
  for (const n of osm) if (!used.has(n.id)) rows.push(osmCameraRow(n, 'HU', fetchedDate));
  return { rows, skipped, matches };
}

/** Az ország összes `highway=speed_camera` csomópontja. */
export function speedCamerasQuery(countryIso: string): string {
  return `[out:json][timeout:180];
area["ISO3166-1"="${countryIso}"][admin_level=2]->.c;
node(area.c)["highway"="speed_camera"];
out body;`;
}

/** 7 tizedesre (≈ 1 cm). */
const round7 = (x: number) => Math.round(x * 1e7) / 1e7;
