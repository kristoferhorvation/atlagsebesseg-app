import type { Section } from '@atlagsebesseg/core';
import { haversineM, type LatLon } from '@atlagsebesseg/core';
import { onewayDirection } from './graph';
import { parseMaxspeed } from './convert';
import type { Skipped } from './convert';
import type { OsmWay } from './overpass';
import { mostCommon, roadRef, roundGeometry } from './routeBetween';

/** Utak, amelyek maguk viselik az átlagsebesség-mérés címkéjét (reláció helyett). */
export function enforcedWaysQuery(countryIso: string): string {
  return `[out:json][timeout:300];
area["ISO3166-1"="${countryIso}"][admin_level=2]->.c;
(
  way["maxspeed:enforcement"="average_speed"](area.c);
  way["enforcement"="average_speed"](area.c);
);
out body geom;`;
}

interface Piece {
  key: string;
  way: OsmWay;
  reversed: boolean;
  nodes: number[];
  points: LatLon[];
}

/**
 * Címkézett utakból irányonkénti szakaszok: az egymáshoz kapcsolódó (azonos irányú) utakat
 * láncba fűzi; egyirányú úton egy, kétirányún két (ellentétes irányú) szakasz lesz.
 */
export function waysToSections(ways: readonly OsmWay[], country: string): { sections: Section[]; skipped: Skipped[] } {
  const pieces: Piece[] = [];
  for (const w of ways) {
    if (!w.geometry || w.geometry.length !== w.nodes.length || w.nodes.length < 2) continue;
    const dir = onewayDirection(w.tags ?? {});
    if (dir >= 0) pieces.push({ key: `${w.id}`, way: w, reversed: false, nodes: w.nodes, points: w.geometry });
    if (dir <= 0) {
      pieces.push({ key: `${w.id}r`, way: w, reversed: true, nodes: [...w.nodes].reverse(), points: [...w.geometry].reverse() });
    }
  }
  const byFirst = new Map<number, Piece[]>();
  for (const p of pieces) {
    const list = byFirst.get(p.nodes[0]!) ?? [];
    list.push(p);
    byFirst.set(p.nodes[0]!, list);
  }
  const next = (p: Piece): Piece[] =>
    (byFirst.get(p.nodes[p.nodes.length - 1]!) ?? []).filter((q) => q.way.id !== p.way.id);
  const incoming = new Map<string, number>();
  for (const p of pieces) for (const q of next(p)) incoming.set(q.key, (incoming.get(q.key) ?? 0) + 1);

  const sections: Section[] = [];
  const skipped: Skipped[] = [];
  const used = new Set<string>();
  for (const head of pieces.filter((p) => !incoming.get(p.key))) {
    const chain: Piece[] = [head];
    used.add(head.key);
    for (;;) {
      const n = next(chain[chain.length - 1]!);
      if (n.length !== 1 || used.has(n[0]!.key) || (incoming.get(n[0]!.key) ?? 0) !== 1) break;
      chain.push(n[0]!);
      used.add(n[0]!.key);
    }
    const geometry: LatLon[] = [];
    for (const p of chain) geometry.push(...(geometry.length ? p.points.slice(1) : p.points));
    let lengthM = 0;
    for (let i = 1; i < geometry.length; i++) lengthM += haversineM(geometry[i - 1]!, geometry[i]!);
    const tags = chain.map((p) => p.way.tags ?? {});
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    const id = `osm-w${first.key}` + (chain.length > 1 ? `-${last.key}` : '');
    const limit = parseMaxspeed(mostCommon(tags.map((t) => t.maxspeed)));
    if (limit === null) {
      skipped.push({ relationId: first.way.id, reason: `${id}: nincs értelmezhető maxspeed` });
      continue;
    }
    if (lengthM < 300) {
      skipped.push({ relationId: first.way.id, reason: `${id}: túl rövid (${Math.round(lengthM)} m)` });
      continue;
    }
    const destination = mostCommon(tags.map((t) => (first.reversed ? t['destination:backward'] : t.destination)));
    sections.push({
      id,
      country,
      road: roadRef(mostCommon(tags.map((t) => t.ref))),
      direction: destination ? `→ ${destination}` : '',
      start: geometry[0]!,
      end: geometry[geometry.length - 1]!,
      lengthM: Math.round(lengthM),
      speedLimitKmh: limit,
      source: 'osm',
      verified: false,
      geometry: roundGeometry(geometry),
    });
  }
  return { sections, skipped };
}
