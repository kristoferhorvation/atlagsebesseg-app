import type { LatLon } from '@atlagsebesseg/core';
import { bboxAround, parseMaxspeed } from './convert';
import { RoadGraph } from './graph';
import type { BBox, OsmWay } from './overpass';
import { mostCommon, roadRef, routeBetween } from './routeBetween';

/** Egy kész kapupár (public.temp_gate_ready_pairs()). */
export interface ReadyPair {
  start_report_id: string;
  end_report_id: string;
  distance_m: number;
  independent_confirms: number;
}

export interface GateReport extends LatLon {
  id: string;
  heading_deg: number;
  gate_kind: 'kezdo' | 'zaro';
  road: string | null;
  speed_limit_kmh: number | null;
}

export interface CreateSectionArgs {
  p_start: string;
  p_end: string;
  /** GeoJSON-sorrend: [[lon, lat], …] */
  p_geometry: [number, number][];
  p_length_m: number;
  p_road: string | null;
  p_speed_limit_kmh: number | null;
  p_country: string | null;
}

/** A külvilág (adatbázis, Overpass) – a tesztben hamisítható. */
export interface PromoteDeps {
  readyPairs(): Promise<ReadyPair[]>;
  reports(ids: string[]): Promise<GateReport[]>;
  roadsIn(bbox: BBox): Promise<OsmWay[]>;
  countryAt(p: LatLon): Promise<string | null>;
  createSection(args: CreateSectionArgs): Promise<string>;
  markFailed(start: string, end: string, error: string): Promise<void>;
}

export interface PromoteOutcome {
  pair: ReadyPair;
  sectionId?: string;
  error?: string;
}

/**
 * Ideiglenes kapupárokból közösségi szakaszok: a kész párokra (SQL dönti el) kiszámolja a
 * köztük futó irányhelyes útvonalat az úthálózaton, és létrehozza a szakaszt.
 */
export async function promoteTempGates(deps: PromoteDeps): Promise<PromoteOutcome[]> {
  const pairs = await deps.readyPairs();
  const out: PromoteOutcome[] = [];
  for (const pair of pairs) {
    try {
      const reports = await deps.reports([pair.start_report_id, pair.end_report_id]);
      const start = reports.find((r) => r.id === pair.start_report_id);
      const end = reports.find((r) => r.id === pair.end_report_id);
      if (!start || !end) throw new Error('a kapu-bejelentés nem található');
      const graph = new RoadGraph(await deps.roadsIn(bboxAround([start, end], 1500)));
      const route = routeBetween(graph, start, end);
      if (typeof route === 'string') throw new Error(route);
      const sectionId = await deps.createSection({
        p_start: start.id,
        p_end: end.id,
        p_geometry: route.geometry.map((p) => [round7(p.lon), round7(p.lat)]),
        p_length_m: Math.round(route.lengthM),
        p_road: roadRef(mostCommon(route.wayTags.map((t) => t.ref))) || null,
        p_speed_limit_kmh: parseMaxspeed(mostCommon(route.wayTags.map((t) => t.maxspeed))),
        p_country: await deps.countryAt(start).catch(() => null),
      });
      out.push({ pair, sectionId });
    } catch (e) {
      const error = (e as Error).message;
      out.push({ pair, error });
      await deps.markFailed(pair.start_report_id, pair.end_report_id, error).catch(() => undefined);
    }
  }
  return out;
}

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;
