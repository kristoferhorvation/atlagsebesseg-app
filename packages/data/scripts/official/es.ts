/**
 * Spanyolország – radares de tramo.
 *
 * Hivatalos, koordinátás forrás: DGT NAP, DATEX II (CC BY) – radares/content.xml, a
 * `GUID_Inventario_CinemometrosVelocidadMedia` halmaz: tramónként `from`/`to` koordináta (TPEG:
 * a haladási irány szerint), útszám és km-szelvény (ini/fin). Határ nincs benne → az OSM-ből,
 * ha az útvonal mentén egyértelmű (különben kimarad). Katalónia és Baszkföld nincs benne.
 * Kiegészítő hivatalos lista: a DGT „Listado de cinemómetros” PDF (2025-03-21, 108 tramo,
 * koordináta nélkül) – összevetése a manual/es-dgt-pdf-2025-03.json-ban: a csak a PDF-ben szereplő
 * tramók, és ahol a két lista hossza ellentmond, kimaradnak.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OfficialItem, OfficialSkip } from '../../src/official';
import type { CountryImporter } from './context';

const here = dirname(fileURLToPath(import.meta.url));
const DATEX = 'https://nap.dgt.es/datex2/dgt/PredefinedLocationsPublication/radares/content.xml';
const DATASET = 'https://nap.dgt.es/dataset/radares-fijos-dgt';

export interface Tramo {
  id: string;
  road: string;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  kmIni: number;
  kmFin: number;
  directionNamed: string | null;
  province: string | null;
}

const tag = (xml: string, name: string) => new RegExp(`<_0:${name}>([^<]*)</_0:${name}>`).exec(xml)?.[1] ?? null;
const point = (xml: string) => ({ lat: Number(tag(xml, 'latitude')), lon: Number(tag(xml, 'longitude')) });

/** A DATEX II fájl szakaszradarjai (regexszel – a szerkezet fix, külső XML-függőség nélkül). */
export function parseDatex(xml: string): { tramos: Tramo[]; publicationTime: string | null } {
  const start = xml.indexOf('id="GUID_Inventario_CinemometrosVelocidadMedia"');
  if (start < 0) return { tramos: [], publicationTime: null };
  const end = xml.indexOf('</_0:predefinedLocationSet>', start);
  const set = xml.slice(start, end < 0 ? undefined : end);
  const tramos: Tramo[] = [];
  for (const m of set.matchAll(/<_0:predefinedLocation id="(GUID_CVM_\d+)">([\s\S]*?)<\/_0:referencePointLinear>/g)) {
    const body = m[2]!;
    const from = /<_0:from[\s>][\s\S]*?<\/_0:from>/.exec(body)?.[0] ?? '';
    const to = /<_0:to[\s>][\s\S]*?<\/_0:to>/.exec(body)?.[0] ?? '';
    const ini = /<_0:referencePointPrimaryLocation>[\s\S]*?<\/_0:referencePointPrimaryLocation>/.exec(body)?.[0] ?? '';
    const fin = /<_0:referencePointSecondaryLocation>[\s\S]*?<\/_0:referencePointSecondaryLocation>/.exec(body)?.[0] ?? '';
    tramos.push({
      id: m[1]!,
      road: tag(ini, 'roadNumber') ?? '',
      from: point(from),
      to: point(to),
      kmIni: Number(tag(ini, 'referencePointDistance')) / 1000,
      kmFin: Number(tag(fin, 'referencePointDistance')) / 1000,
      directionNamed: tag(ini, 'directionNamed') ?? tag(fin, 'directionNamed'),
      province: tag(ini, 'value'),
    });
  }
  return { tramos, publicationTime: /<_0:publicationTime>([^<]+)</.exec(xml)?.[1] ?? null };
}

export const importES: CountryImporter = async (ctx) => {
  const { tramos, publicationTime } = parseDatex(await ctx.fetchText(DATEX, 'radares.xml'));
  const date = (publicationTime ?? new Date().toISOString()).slice(0, 10);
  ctx.log(`DATEX (${date}): ${tramos.length} szakaszradar`);
  const pdf = JSON.parse(await readFile(join(here, '..', '..', 'manual', 'es-dgt-pdf-2025-03.json'), 'utf8')) as {
    pdf: string;
    pdf_csak: { provincia: string; carretera: string; pk_km: string; sentido: string; longitud_m: number }[];
    ellentmondasos: { cvm: string; reason: string }[];
  };
  const conflict = new Map(pdf.ellentmondasos.map((c) => [c.cvm, c.reason]));

  const provenance = { name: 'DGT (NAP, DATEX II)', url: DATASET, date, locatedBy: 'koordinata' } as const;
  const items: OfficialItem[] = [];
  const skipped: OfficialSkip[] = pdf.pdf_csak.map((p, i) => ({
    id: `es-pdf-${i + 1}`,
    label: `${p.carretera} pk ${p.pk_km} ${p.sentido} (${p.provincia}, ${p.longitud_m} m)`,
    reason: 'csak a DGT PDF-listáján szerepel, koordináta nélkül (a DATEX-ben nincs) – a kapuk helye nem azonosítható',
  }));
  for (const t of tramos) {
    const label = `${t.road} km ${t.kmIni} → ${t.kmFin}${t.directionNamed ? ` (dir. ${t.directionNamed})` : ''}, ${t.province ?? ''} [${t.id}]`;
    const id = `es-dgt-${t.id.replace('GUID_CVM_', '')}`;
    if (conflict.has(t.id)) {
      skipped.push({ id, label, reason: conflict.get(t.id)! });
      continue;
    }
    if (![t.from.lat, t.from.lon, t.to.lat, t.to.lon].every(Number.isFinite) || !t.road) {
      skipped.push({ id, label, reason: 'hiányzó koordináta vagy útszám' });
      continue;
    }
    items.push({
      id,
      country: 'ES',
      road: t.road,
      direction: t.directionNamed ? `→ ${t.directionNamed.charAt(0)}${t.directionNamed.slice(1).toLowerCase()}` : '',
      label,
      start: t.from,
      end: t.to,
      speedLimitKmh: null,
      officialLengthM: Number.isFinite(t.kmIni) && Number.isFinite(t.kmFin) ? Math.abs(t.kmFin - t.kmIni) * 1000 : undefined,
      provenance,
    });
  }
  return {
    sources: [
      { name: 'DGT (NAP, DATEX II)', url: DATEX, date, note: `${tramos.length} szakaszradar koordinátával; határ nélkül (az OSM-ből, ha egyértelmű)` },
      { name: 'DGT – Listado de cinemómetros (PDF)', url: pdf.pdf, date: '2025-03-21', note: '108 radar de tramo, koordináta nélkül' },
    ],
    // a két lista uniója: a PDF 108 sora + a csak DATEX-ben szereplők
    listed: pdf.pdf_csak.length + tramos.length,
    items,
    skipped,
    minorRoads: true,
  };
};
