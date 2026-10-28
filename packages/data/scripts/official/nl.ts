/**
 * Hollandia – trajectcontroles.
 *
 * Hivatalos lista: Openbaar Ministerie (om.nl, trajectcontroles, 2026-06-18) – csak helyszínnevek.
 * Irányok: OM „Instroom WAHV 2024” PDF; hectometer és határ: az OM saját hírei (soronként a
 * forrás-URL a manual/nl-om-trajecten.json-ban). Ahol a hivatalos forrás nem ad hectometert, a
 * kapuk helye nem azonosítható → kimarad.
 * Hectometer → koordináta: Rijkswaterstaat NWB (CC-0) WFS, `hectopunten` a fő pályán (`bst_code`
 * = HR, betűjel nélkül), az útszám szerinti `wegvakken`-hez kötve; a jelöltek (két pályatest)
 * átlaga, ha 150 m-en belül vannak.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineM, type LatLon } from '@atlagsebesseg/core';
import type { OfficialItem, OfficialSkip } from '../../src/official';
import type { CountryImporter, ImportContext } from './context';

const here = dirname(fileURLToPath(import.meta.url));
const WFS = 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/nwb_wegen/ows';

interface Traject {
  weg: string;
  omschrijving: string;
  richting: string;
  hm_van: number | null;
  hm_tot: number | null;
  max_kmh: number | null;
  bron: string;
  opmerking: string;
}

/** NWB-szűrő az útszámhoz: rijkswegen 3 jegyű `wegnummer` + `routeltr`/`routenr`, provinciale wegen „N260”. */
export function nwbFilter(weg: string): string {
  const m = /^([AN])(\d+)$/.exec(weg);
  if (!m) throw new Error(`ismeretlen útszám: ${weg}`);
  const [, ltr, nr] = m as unknown as [string, string, string];
  const rijksweg = ltr === 'A' || Number(nr) < 100;
  const wegnummer = rijksweg ? nr.padStart(3, '0') : weg;
  return `wegnummer='${wegnummer}' AND bst_code='HR' AND routeltr='${ltr}' AND routenr='${nr}'`;
}

async function wfs(ctx: ImportContext, typeName: string, cql: string, props: string, file: string) {
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: `nwb_wegen:${typeName}`,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: cql,
    propertyName: props,
  });
  return JSON.parse(await ctx.fetchText(`${WFS}?${q}`, file)) as {
    features: { geometry: { coordinates: [number, number] } | null; properties: Record<string, string | number> }[];
  };
}

/** Hectometer → hely: a fő pálya hectopontjai; több jelölt (két pályatest) átlaga, ha ≤ 150 m-en belül. */
export function averageClose(points: readonly LatLon[]): LatLon | string {
  if (!points.length) return 'nincs ilyen hectometerpont a fő pályán (NWB)';
  const c = { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lon: points.reduce((s, p) => s + p.lon, 0) / points.length };
  const spread = Math.max(...points.map((p) => haversineM(p, c)));
  return spread > 150 ? `a hectometerpontok szétszórtak (${Math.round(spread)} m) – nem egyértelmű` : c;
}

export const importNL: CountryImporter = async (ctx) => {
  const doc = JSON.parse(await readFile(join(here, '..', '..', 'manual', 'nl-om-trajecten.json'), 'utf8')) as {
    lijst: string;
    lijst_datum: string;
    trajecten: Traject[];
  };
  const provenance = { name: 'Openbaar Ministerie', url: doc.lijst, date: doc.lijst_datum, locatedBy: 'km_szelveny' } as const;
  const items: OfficialItem[] = [];
  const skipped: OfficialSkip[] = [];
  const wvkByWeg = new Map<string, number[]>();

  const locate = async (weg: string, hm: number): Promise<LatLon | string> => {
    let ids = wvkByWeg.get(weg);
    if (!ids) {
      const res = await wfs(ctx, 'wegvakken', nwbFilter(weg), 'wvk_id', `wegvakken-${weg}.json`);
      ids = res.features.map((f) => Number(f.properties.wvk_id));
      wvkByWeg.set(weg, ids);
      ctx.log(`${weg}: ${ids.length} fő pályás NWB-útszakasz`);
    }
    if (!ids.length) return `az NWB-ben nincs ${weg} fő pálya`;
    const tenth = Math.round(hm * 10);
    const res = await wfs(ctx, 'hectopunten', `hectomtrng=${tenth} AND wvk_id IN (${ids.join(',')})`, 'hectomtrng,hecto_lttr,wvk_id,shape', `hecto-${weg}-${tenth}.json`);
    const pts = res.features
      .filter((f) => f.geometry && !f.properties.hecto_lttr)
      .map((f) => ({ lat: f.geometry!.coordinates[1], lon: f.geometry!.coordinates[0] }));
    return averageClose(pts);
  };

  // a „mindkét irányra szóló” tartományok (Rechts/Links ugyanazzal a hm-párral) – a sorrend nem rendelhető
  // a sor nevéhez, ezért az irány neve helyett égtáj; a két sorrend két tétel
  const seenRange = new Set<string>();
  for (const [i, t] of doc.trajecten.entries()) {
    const label = `${t.weg} ${t.omschrijving} – ${t.richting}${t.hm_van !== null ? ` (hm ${t.hm_van} → ${t.hm_tot})` : ''}`;
    const id = `nl-om-${t.weg.toLowerCase()}-${i + 1}`;
    if (t.hm_van === null || t.hm_tot === null) {
      skipped.push({ id, label, reason: 'a hivatalos forrás nem ad hectometert (kapuhelyet) ehhez a szakaszhoz' });
      continue;
    }
    const unordered = /hm-volgorde per rijrichting niet in bron/.test(t.opmerking);
    let [from, to] = [t.hm_van, t.hm_tot];
    let direction = t.richting.replace(/^.*?:\s*/, '').replace(/\s+-\s+/, ' → ').replace(/^van\s+(.+?)\s+(?:richting|naar)\s+(.+)$/i, '$1 → $2');
    if (unordered) {
      const key = `${t.weg}:${Math.min(from, to)}:${Math.max(from, to)}`;
      const second = seenRange.has(key);
      seenRange.add(key);
      [from, to] = second ? [Math.max(from, to), Math.min(from, to)] : [Math.min(from, to), Math.max(from, to)];
      direction = '';
    }
    const start = await locate(t.weg, from);
    const end = await locate(t.weg, to);
    if (typeof start === 'string' || typeof end === 'string') {
      skipped.push({ id, label, reason: `hm ${typeof start === 'string' ? from : to}: ${typeof start === 'string' ? start : end}` });
      continue;
    }
    items.push({
      id,
      country: 'NL',
      road: t.weg,
      direction,
      label: unordered ? `${t.weg} ${t.omschrijving} (hm ${from} → ${to})` : label,
      start,
      end,
      speedLimitKmh: t.max_kmh,
      provenance,
    });
  }
  return {
    sources: [
      { name: 'Openbaar Ministerie', url: doc.lijst, date: doc.lijst_datum, note: 'trajectcontroles-lista; hectometer/határ az OM-hírekből' },
      { name: 'Rijkswaterstaat NWB (hectopunten)', url: WFS, date: new Date().toISOString().slice(0, 10), note: 'CC-0, hectometer → koordináta' },
    ],
    listed: doc.trajecten.length,
    items,
    skipped,
    minorRoads: true,
  };
};
