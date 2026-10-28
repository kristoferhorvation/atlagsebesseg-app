import { mergeById, type EnforcementData, type FixedCamera, type NavRoute, type PlannedCheck } from '@atlagsebesseg/app-logic';
import { BUNDLED_CAMERAS } from '@atlagsebesseg/app-logic/bundled-cameras';
import { BUNDLED_SECTIONS } from '@atlagsebesseg/app-logic/bundled-sections';
import { haversineM, type LatLon } from '@atlagsebesseg/core';
import { cameraCache, plannedCache, sectionCache, supabase } from '../backend';

/** Az útvonal pontjai `stepM` méterenként (és a vége) – a csempék betöltéséhez. */
export function sampleRoute(route: NavRoute, stepM: number): LatLon[] {
  const out: LatLon[] = [route.points[0]!];
  let acc = 0;
  for (let i = 1; i < route.points.length; i++) {
    acc += haversineM(route.points[i - 1]!, route.points[i]!);
    if (acc >= stepM) {
      out.push(route.points[i]!);
      acc = 0;
    }
  }
  out.push(route.points.at(-1)!);
  return out;
}

const byId = <T extends { id: string }>(...lists: (readonly T[])[]): T[] => [...new Map(lists.flat().map((x) => [x.id, x])).values()];

/**
 * Az útvonal menti szakaszok, kamerák, tervezett mérések: a beépített lista + az útvonalat érő
 * csempék a szerverről (a meglévő cache-eken át). Szerver nélkül csak a beépített adat.
 */
export async function loadRouteData(route: NavRoute): Promise<EnforcementData> {
  if (!supabase) return { sections: [...BUNDLED_SECTIONS], cameras: [...BUNDLED_CAMERAS], planned: [] };
  // a csempe ~0,5° (a 3 × 3 szomszédsággal együtt bőven lefedi) – 35 km-enként elég mintát venni
  const samples = sampleRoute(route, 35_000);
  const loaded = await Promise.all(
    samples.map(async (p) => {
      const [s, c, pl] = await Promise.all([sectionCache.loadItems(p.lat, p.lon), cameraCache.loadItems(p.lat, p.lon), plannedCache.loadItems(p.lat, p.lon)]);
      return { s: s.items, c: c.items as FixedCamera[], pl: pl.items as PlannedCheck[] };
    }),
  );
  return {
    sections: mergeById(BUNDLED_SECTIONS, ...loaded.map((x) => x.s)),
    cameras: byId(BUNDLED_CAMERAS, ...loaded.map((x) => x.c)),
    planned: byId(...loaded.map((x) => x.pl)),
  };
}
