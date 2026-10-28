/**
 * Lengyelország – GITD / CANARD, odcinkowy pomiar prędkości (OPP).
 *
 * Forrás: a CANARD honlapi eszköztérképe (https://www.canard.gitd.gov.pl/cms/web/guest/o-nas/mapa-urzadzen).
 * Külön letölthető lista nincs; a térkép oldala beágyazva adja az OPP-eszközök listáját
 * (`fotoradaryOPP`, LZString base64), az eszközönkénti részleteket pedig a térkép saját
 * végpontja (POST …/objdata, LZString UTF16): útszám, mindkét pont koordinátája, irányonkénti
 * hossz (`dlugoscOdcinka1/2`, 0 = abban az irányban nem mér), határ (`limity`), állapot,
 * hitelesítés lejárata.
 */
import LZString from 'lz-string';
import type { LatLon } from '@atlagsebesseg/core';
import type { OfficialItem, OfficialSkip } from '../../src/official';
import type { CountryImporter } from './context';

const PAGE = 'https://www.canard.gitd.gov.pl/cms/web/guest/o-nas/mapa-urzadzen';

interface OppListItem {
  id: number;
  lon: number;
  lat: number;
  lok2PktDlugosc: number | null;
  lok2PktSzerokosc: number | null;
}

/** Az eszköz részletei (a forrás mezőnevei). */
export interface OppDetail {
  lon: number;
  lat: number;
  urzadzenie: {
    id: number;
    nrSeryjny: string;
    stanTechniczny: string;
    mobilne: boolean;
    lokalizacjaNrDrogi: string | null;
    lokalizacjaAdresMiejscowosc: string | null;
    lokalizacjaDrugiegoPunktu: string | null;
    dataUplywuWazLegalizacji: string | null;
    dlugoscOdcinka1: number | null;
    dlugoscOdcinka2: number | null;
    nazwaKierunku1: string | null;
    nazwaKierunku2: string | null;
  };
  limity: { limitOsobowe: string | null; limitCiezarowe: string | null; typ: { kierunek: string } }[];
}

/** Útszám a forrásból: 1–2 jegyű = országos (DK), 3 jegyű = vajdasági (DW), egyébként változatlan. */
export function plRoad(nr: string): string {
  if (/^\d{1,2}$/.test(nr)) return `DK${nr}`;
  if (/^\d{3}$/.test(nr)) return `DW${nr}`;
  return nr;
}

/** "lon;lat" → LatLon */
function parsePoint(s: string | null): LatLon | null {
  const [lon, lat] = (s ?? '').split(';').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 ? { lat: lat!, lon: lon! } : null;
}

const close = (a: LatLon, b: LatLon, m: number) => Math.abs(a.lat - b.lat) * 111_000 < m && Math.abs(a.lon - b.lon) * 70_000 < m;

/**
 * Részletekből irányonkénti tételek. Az irányok NEM rendelhetők a pontsorrendhez (a forrás nem
 * mondja meg, melyik `nazwaKierunku` melyik), ezért: ha az eszköz mindkét irányban mér, mindkét
 * pontsorrend tétel; ha csak az egyikben, akkor csak akkor, ha egy másik, ugyanazon a szakaszon
 * mérő eszköz a másik irányt adja (más iránynévvel) – különben kimarad.
 */
export function plItems(details: OppDetail[], today: string, provenance: OfficialItem['provenance']): { items: OfficialItem[]; skipped: OfficialSkip[]; listed: number } {
  const items: OfficialItem[] = [];
  const skipped: OfficialSkip[] = [];
  let listed = 0;
  const single: { d: OppDetail; a: LatLon; b: LatLon; name: string }[] = [];

  for (const d of details) {
    const u = d.urzadzenie;
    const dirs = [(u.dlugoscOdcinka1 ?? 0) > 0, (u.dlugoscOdcinka2 ?? 0) > 0].filter(Boolean).length;
    listed += dirs;
    const road = plRoad(u.lokalizacjaNrDrogi ?? '');
    const label = `${road} ${u.lokalizacjaAdresMiejscowosc ?? ''} (${u.nrSeryjny})`.replace(/\s+/g, ' ');
    // irányonként egy kihagyás-sor, hogy a mérleg (listán = bekerült + kimaradt) kijöjjön
    const skip = (reason: string) => {
      for (let i = 1; i <= Math.max(1, dirs); i++) skipped.push({ id: `pl-gitd-${u.id}-${i}`, label: `${label}${dirs > 1 ? `, ${i}. irány` : ''}`, reason });
    };
    const a: LatLon = { lat: d.lat, lon: d.lon };
    const b = parsePoint(u.lokalizacjaDrugiegoPunktu);
    if (u.stanTechniczny !== 'Sprawne') skip(`állapot: ${u.stanTechniczny}`);
    else if (u.mobilne) skip('mobil eszköz');
    else if (u.dataUplywuWazLegalizacji && u.dataUplywuWazLegalizacji < today) skip(`a hitelesítés lejárt (${u.dataUplywuWazLegalizacji})`);
    else if (!u.lokalizacjaNrDrogi) skip('nincs útszám');
    else if (!b) skip('nincs második pont (koordináta)');
    else if (d.limity.length !== 1 || d.limity[0]!.typ.kierunek) skip('irányfüggő vagy többféle határ, irányhoz nem rendelhető egyértelműen');
    else if (!Number(d.limity[0]!.limitOsobowe)) skip('nincs személyautó-határ');
    else if (dirs === 0) skip('egyik irányban sem mér (hossz 0)');
    else if (dirs === 1) single.push({ d, a, b, name: (u.dlugoscOdcinka1 ?? 0) > 0 ? (u.nazwaKierunku1 ?? '') : (u.nazwaKierunku2 ?? '') });
    else {
      const l1 = u.dlugoscOdcinka1!;
      const l2 = u.dlugoscOdcinka2!;
      // a két irány hossza nem rendelhető a pontsorrendhez; ha közel egyforma, az átlag a hivatalos
      const officialLengthM = Math.abs(l1 - l2) <= 50 ? (l1 + l2) / 2 : undefined;
      for (const [s, e, suffix] of [[a, b, 'ab'], [b, a, 'ba']] as const) {
        items.push({
          id: `pl-gitd-${u.id}-${suffix}`,
          country: 'PL',
          road,
          direction: '',
          label: `${label}, ${suffix === 'ab' ? '1→2' : '2→1'} pont`,
          start: s,
          end: e,
          speedLimitKmh: Number(d.limity[0]!.limitOsobowe),
          officialLengthM,
          provenance,
        });
      }
    }
  }

  // egyirányú eszközök: csak ellentétes párban (két eszköz, ugyanaz a szakasz, eltérő iránynév)
  const used = new Set<number>();
  for (const x of single) {
    const u = x.d.urzadzenie;
    if (used.has(u.id)) continue;
    const pair = single.find(
      (y) => y !== x && !used.has(y.d.urzadzenie.id) && y.name !== x.name &&
        ((close(x.a, y.a, 300) && close(x.b, y.b, 300)) || (close(x.a, y.b, 300) && close(x.b, y.a, 300))),
    );
    const road = plRoad(u.lokalizacjaNrDrogi!);
    const label = `${road} ${u.lokalizacjaAdresMiejscowosc ?? ''} (${u.nrSeryjny})`.replace(/\s+/g, ' ');
    if (!pair) {
      skipped.push({ id: `pl-gitd-${u.id}`, label, reason: `csak egy irányban mér („${x.name}”), és a forrás nem adja meg, melyik pontsorrendben` });
      continue;
    }
    used.add(u.id);
    used.add(pair.d.urzadzenie.id);
    for (const [s, e, suffix] of [[x.a, x.b, 'ab'], [x.b, x.a, 'ba']] as const) {
      items.push({
        id: `pl-gitd-${u.id}-${pair.d.urzadzenie.id}-${suffix}`,
        country: 'PL',
        road,
        direction: '',
        label: `${label} + ${pair.d.urzadzenie.nrSeryjny}, ${suffix === 'ab' ? '1→2' : '2→1'} pont`,
        start: s,
        end: e,
        speedLimitKmh: Number(x.d.limity[0]!.limitOsobowe),
        provenance,
      });
    }
  }
  return { items, skipped, listed };
}

export const importPL: CountryImporter = async (ctx) => {
  const html = await ctx.fetchText(PAGE, 'mapa-urzadzen.html');
  const packed = /fotoradaryOPP:"([^"]+)"/.exec(html)?.[1];
  const url = /objOPPDataURL:"([^"]+)"/.exec(html)?.[1];
  const ns = /namespace:"(_pl_canard[^"]+)"/.exec(html)?.[1];
  if (!packed || !url || !ns) throw new Error('a CANARD-térkép oldalán nem található az OPP-lista / végpont');
  const list = JSON.parse(LZString.decompressFromBase64(packed) ?? '[]') as OppListItem[];
  ctx.log(`${list.length} OPP-eszköz a térképen`);

  const details: OppDetail[] = [];
  for (const it of list) {
    const raw = await ctx.fetchText(url, `opp/${it.id}.lzutf16`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ [`${ns}id`]: String(it.id) }).toString(),
    });
    const d = JSON.parse(LZString.decompressFromUTF16(raw) ?? 'null') as OppDetail | null;
    if (d) details.push({ ...d, lon: d.lon ?? it.lon, lat: d.lat ?? it.lat });
  }

  const today = new Date().toISOString().slice(0, 10);
  const provenance = { name: 'GITD (CANARD)', url: PAGE, date: today, locatedBy: 'koordinata' } as const;
  const r = plItems(details, today, provenance);
  return {
    sources: [{ name: 'GITD (CANARD)', url: PAGE, date: today, note: 'eszköztérkép (OPP), napi frissítésű; a dátum a letöltés napja' }],
    listed: r.listed,
    items: r.items,
    skipped: r.skipped,
    minorRoads: true,
    snapRadiusM: 80,
  };
};
