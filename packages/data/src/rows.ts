import type { LatLon, Section, SectionLocatedBy } from '@atlagsebesseg/core';

/** A `public.sections` tábla egy sora (lásd supabase/migrations). */
export interface SectionRow {
  id: string;
  country: string;
  road: string;
  direction: string;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  length_m: number;
  speed_limit_kmh: number;
  source: Section['source'];
  verified: boolean;
  /** GeoJSON-sorrend: [[lon, lat], …] */
  geometry: [number, number][] | null;
  expires_at?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  source_date?: string | null;
  located_by?: SectionLocatedBy | null;
}

export function sectionToRow(s: Section): SectionRow {
  return {
    id: s.id,
    country: s.country.toUpperCase(),
    road: s.road,
    direction: s.direction,
    start_lat: s.start.lat,
    start_lon: s.start.lon,
    end_lat: s.end.lat,
    end_lon: s.end.lon,
    length_m: Math.round(s.lengthM),
    speed_limit_kmh: Math.round(s.speedLimitKmh),
    source: s.source,
    verified: s.verified,
    geometry: s.geometry?.length ? s.geometry.map((p) => [p.lon, p.lat]) : null,
    source_name: s.provenance?.name ?? null,
    source_url: s.provenance?.url ?? null,
    source_date: s.provenance?.date ?? null,
    located_by: s.provenance?.locatedBy ?? null,
  };
}

export function rowToSection(r: SectionRow): Section {
  const geometry: LatLon[] | undefined = Array.isArray(r.geometry) && r.geometry.length >= 2
    ? r.geometry.map(([lon, lat]) => ({ lat, lon }))
    : undefined;
  return {
    id: r.id,
    country: r.country,
    road: r.road,
    direction: r.direction,
    start: { lat: r.start_lat, lon: r.start_lon },
    end: { lat: r.end_lat, lon: r.end_lon },
    lengthM: r.length_m,
    speedLimitKmh: r.speed_limit_kmh,
    source: r.source,
    verified: r.verified,
    ...(geometry ? { geometry } : {}),
    ...(r.source_name && r.source_url && r.source_date && r.located_by
      ? { provenance: { name: r.source_name, url: r.source_url, date: r.source_date, locatedBy: r.located_by } }
      : {}),
  };
}
