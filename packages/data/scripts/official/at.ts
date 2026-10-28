/**
 * Ausztria – fix Section Control (ASFINAG).
 *
 * A meglévő (OSM) szakaszok MARADNAK; összevetjük őket az ASFINAG 6 fix helyszínével. Az ASFINAG
 * nem közöl listát, a helyszínek pontos km-adatai a hatályos „Section Control-
 * Messstreckenverordnung”-okból jönnek (RIS) – manual/at-asfinag-section-control.json.
 * Egyezés: azonos út, az OSM-szakasz két vége ≤ 400 m-re a rendelet km-szelvényeiből (OSM km-kövek)
 * számolt kapuktól, hossza ±15%-on belül. Ami egyezik, `verified: true` + ASFINAG/RIS forrás.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineM, type LatLon, type Section } from '@atlagsebesseg/core';
import type { OfficialSkip } from '../../src/official';
import { osmProvenance, type SectionFile } from '../../src/output';
import type { OsmNode } from '../../src/overpass';
import type { CountryImporter } from './context';
import { locateKm, milestonesFrom } from './it';

const here = dirname(fileURLToPath(import.meta.url));

interface Standort {
  standort: string;
  strasse: string;
  richtung: string;
  km_von: number | null;
  km_bis: number | null;
  verordnung: string;
  url: string | null;
}

/** "A 22 Donauufer Autobahn" → "A22" */
export const atRoad = (s: string) => /^([AS])\s*(\d+)/.exec(s)?.slice(1).join('') ?? '';

/** Egyezik-e egy OSM-szakasz a rendeleti szakasszal (bármely irányban, ha a rendelet mindkettőre szól). */
export function matchesOfficial(s: Section, a: LatLon, b: LatLon, lengthM: number, bothDirections: boolean): boolean {
  const near = (p: LatLon, q: LatLon) => haversineM(p, q) <= 400;
  const fwd = near(s.start, a) && near(s.end, b);
  const back = bothDirections && near(s.start, b) && near(s.end, a);
  return (fwd || back) && Math.abs(s.lengthM - lengthM) <= 0.15 * lengthM;
}

export const importAT: CountryImporter = async (ctx) => {
  const existing = JSON.parse(await readFile(join(here, '..', '..', 'osm', 'sections.AT.json'), 'utf8')) as SectionFile;
  // a korábbi futás ellenőrzött jelölése nem öröklődik: mindig újra összevetjük
  const osm = existing.sections.map((s) => ({ ...s, verified: false, provenance: undefined }) as Section);
  const doc = JSON.parse(await readFile(join(here, '..', '..', 'manual', 'at-asfinag-section-control.json'), 'utf8')) as {
    asfinag: string;
    asfinag_datum: string;
    standorte: Standort[];
  };

  const skipped: OfficialSkip[] = [];
  let listed = 0;
  let matched = 0;
  for (const [i, st] of doc.standorte.entries()) {
    const both = /beide/i.test(st.richtung);
    listed += both ? 2 : 1;
    const road = atRoad(st.strasse);
    const label = `${road} ${st.standort} – ${st.richtung || 'irány ismeretlen'}${st.km_von !== null ? ` (km ${st.km_von} → ${st.km_bis})` : ''}`;
    const skip = (reason: string) => {
      for (let k = 0; k < (both ? 2 : 1); k++) skipped.push({ id: `at-asfinag-${i + 1}${both ? `-${k + 1}` : ''}`, label, reason });
    };
    if (st.km_von === null || st.km_bis === null || !road) {
      skip(`nincs hatályos mérőszakasz-rendelet / km-adat (${st.verordnung})`);
      continue;
    }
    const res = await ctx.overpass(`[out:json][timeout:240];
area["ISO3166-1"="AT"][admin_level=2]->.c;
way["highway"="motorway"]["ref"~"^${road.replace(/(\D)(\d)/, '$1 ?$2')}([;]|$)"](area.c)->.w;
node(around.w:60)["highway"="milestone"];
out body;`);
    const ms = milestonesFrom(res.elements.filter((e): e is OsmNode => e.type === 'node'), road).concat(
      milestonesFrom(res.elements.filter((e): e is OsmNode => e.type === 'node'), road.replace(/(\D)(\d)/, '$1 $2')),
    );
    const a = locateKm(ms, st.km_von);
    const b = locateKm(ms, st.km_bis);
    if (typeof a === 'string' || typeof b === 'string') {
      skip(`a rendeleti km nem köthető helyhez: ${typeof a === 'string' ? a : b}`);
      continue;
    }
    const lengthM = Math.abs(st.km_bis - st.km_von) * 1000;
    const hits = osm.filter((s) => s.road.replace(/\s/g, '') === road && matchesOfficial(s, a, b, lengthM, both));
    if (!hits.length) {
      skip('a meglévő OSM-szakaszok között nincs egyező (út, kapuk ≤ 400 m, hossz ±15%)');
      continue;
    }
    for (const h of hits) {
      h.verified = true;
      h.provenance = { name: 'ASFINAG / RIS', url: st.url ?? doc.asfinag, date: '2026-10-27', locatedBy: 'km_szelveny' };
      matched++;
    }
    // ha a rendelet két irányra szól, de csak az egyik van meg az OSM-ben, a másik kimarad
    for (let k = hits.length; k < (both ? 2 : 1); k++) {
      skipped.push({ id: `at-asfinag-${i + 1}-${k + 1}`, label, reason: 'az egyik irány nincs a meglévő OSM-szakaszok között' });
    }
  }
  // a nem egyezők OSM-forrással maradnak
  for (const s of osm) if (!s.provenance) s.provenance = osmProvenance(s.id, existing.generatedAt ?? new Date().toISOString());
  ctx.log(`${matched} meglévő szakasz egyezik az ASFINAG/RIS-listával`);
  return {
    sources: [
      { name: 'ASFINAG', url: doc.asfinag, date: doc.asfinag_datum, note: '6 fix Section Control (lista nélkül)' },
      { name: 'RIS – Section Control-Messstreckenverordnungen', url: 'https://www.ris.bka.gv.at/', date: '2026-10-27', note: 'km-szelvények a hatályos rendeletekből' },
      { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/', date: (existing.generatedAt ?? '').slice(0, 10), note: 'a meglévő 10 szakasz' },
    ],
    listed,
    items: [],
    skipped,
    keep: osm,
    included: matched,
  };
};
