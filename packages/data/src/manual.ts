import { bearingDeg, haversineM, type LatLon, type Section } from '@atlagsebesseg/core';
import { angleDiffDeg } from '@atlagsebesseg/core';
import type { RoadGraph } from './graph';
import { roadRef, roundGeometry, routeBetween } from './routeBetween';

/**
 * Kézzel karbantartott szakaszlista (pl. `manual/hu-manual.json`), amit az import összefésül
 * az OSM-adattal. Egy bejegyzés = kezdőkapu + zárókapu + irány + határ.
 */
export interface ManualSectionEntry {
  /** Egyedi, stabil azonosító, pl. "hu-m1-bicske-tatabanya". */
  id: string;
  road: string;
  /** Emberi olvasásra, pl. "Budapest → Győr". */
  direction: string;
  start: LatLon;
  end: LatLon;
  /** Haladási irány a kezdőkapunál (fok, 0 = észak); ellenőrzésre és a pályatest kiválasztásához. */
  headingDeg?: number;
  speedLimitKmh: number;
  /** Hivatalos hossz méterben, ha ismert (különben az útvonalból számoljuk). */
  lengthM?: number;
  source: 'hivatalos' | 'kozosseg';
  verified: boolean;
  /** Honnan származik az adat (URL, közlöny-szám, saját mérés dátuma). */
  reference: string;
  note?: string;
}

export interface ManualFile {
  country: string;
  description?: string;
  sections: ManualSectionEntry[];
}

/** A kézi fájl ellenőrzése; hibalistát ad (üres = rendben). */
export function validateManualFile(data: unknown): { file: ManualFile | null; errors: string[] } {
  const errors: string[] = [];
  const f = data as Partial<ManualFile>;
  if (!f || typeof f !== 'object') return { file: null, errors: ['nem objektum'] };
  if (typeof f.country !== 'string' || !/^[A-Z]{2}$/.test(f.country)) errors.push('country: kétbetűs nagybetűs kód kell');
  if (!Array.isArray(f.sections)) return { file: null, errors: [...errors, 'sections: tömb kell'] };
  const ids = new Set<string>();
  const isLatLon = (p: unknown): p is LatLon =>
    !!p && typeof p === 'object' && Math.abs((p as LatLon).lat) <= 90 && Math.abs((p as LatLon).lon) <= 180 &&
    Number.isFinite((p as LatLon).lat) && Number.isFinite((p as LatLon).lon);
  f.sections.forEach((s, i) => {
    const at = `sections[${i}]${s && typeof s.id === 'string' ? ` (${s.id})` : ''}`;
    if (!s || typeof s.id !== 'string' || !s.id) return errors.push(`${at}: id kötelező`);
    if (ids.has(s.id)) errors.push(`${at}: ismétlődő id`);
    ids.add(s.id);
    if (typeof s.road !== 'string' || !s.road) errors.push(`${at}: road kötelező`);
    if (!isLatLon(s.start) || !isLatLon(s.end)) errors.push(`${at}: start/end {lat, lon} kell`);
    else if (haversineM(s.start, s.end) < 300) errors.push(`${at}: a kapuk túl közel vannak (< 300 m)`);
    if (!(s.speedLimitKmh >= 20 && s.speedLimitKmh <= 200)) errors.push(`${at}: speedLimitKmh 20–200 között`);
    if (s.headingDeg !== undefined && !(s.headingDeg >= 0 && s.headingDeg < 360)) errors.push(`${at}: headingDeg 0–359`);
    if (s.lengthM !== undefined && !(s.lengthM > 0)) errors.push(`${at}: lengthM pozitív`);
    if (s.source !== 'hivatalos' && s.source !== 'kozosseg') errors.push(`${at}: source hivatalos | kozosseg`);
    if (typeof s.verified !== 'boolean') errors.push(`${at}: verified logikai érték`);
    if (typeof s.reference !== 'string' || !s.reference) errors.push(`${at}: reference (forrás) kötelező`);
    if (isLatLon(s.start) && isLatLon(s.end) && s.headingDeg !== undefined) {
      const b = bearingDeg(s.start, s.end);
      if (angleDiffDeg(b, s.headingDeg) > 100) errors.push(`${at}: headingDeg ellentmond a start→end iránynak`);
    }
  });
  return { file: errors.length ? null : (f as ManualFile), errors };
}

/** Kézi bejegyzés → Section; ha van úthálózat, abból kap geometriát (különben anélkül). */
export function manualToSection(entry: ManualSectionEntry, country: string, graph?: RoadGraph): { section: Section; warning?: string } {
  const base: Section = {
    id: entry.id,
    country,
    road: entry.road,
    direction: entry.direction,
    start: entry.start,
    end: entry.end,
    lengthM: Math.round(entry.lengthM ?? haversineM(entry.start, entry.end)),
    speedLimitKmh: entry.speedLimitKmh,
    source: entry.source,
    verified: entry.verified,
  };
  if (!graph) return { section: base, warning: `${entry.id}: nincs úthálózat, geometria nélkül` };
  const r = routeBetween(graph, entry.start, entry.end);
  if (typeof r === 'string') return { section: base, warning: `${entry.id}: ${r} – geometria nélkül` };
  const road = roadRef(r.wayTags.map((t) => t.ref).find(Boolean));
  return {
    section: { ...base, lengthM: Math.round(entry.lengthM ?? r.lengthM), geometry: roundGeometry(r.geometry) },
    warning: road && road !== entry.road ? `${entry.id}: az úthálózat szerint ${road}, nem ${entry.road}` : undefined,
  };
}

/** Két szakasz ugyanaz-e: kezdő- és végpont is legfeljebb `toleranceM`-re (azonos irány). */
export function sameSection(a: Section, b: Section, toleranceM = 300): boolean {
  return haversineM(a.start, b.start) <= toleranceM && haversineM(a.end, b.end) <= toleranceM;
}

/**
 * OSM + kézi lista összefésülése. Egyezésnél a kézi bejegyzés nyer (hivatalos/ellenőrzött adat),
 * de ha neki nincs geometriája, az OSM-ét kapja meg.
 */
export function mergeSections(osm: readonly Section[], manual: readonly Section[]): { sections: Section[]; replaced: string[] } {
  const replaced: string[] = [];
  const out = manual.map((m) => {
    const match = osm.find((o) => sameSection(o, m));
    if (match) replaced.push(match.id);
    return match && !m.geometry?.length && match.geometry ? { ...m, geometry: match.geometry } : m;
  });
  for (const o of osm) if (!replaced.includes(o.id)) out.push(o);
  return { sections: out.sort((a, b) => a.id.localeCompare(b.id)), replaced };
}
