import { describe, expect, it } from 'vitest';
import { haversineM, type Section } from '@atlagsebesseg/core';
import { atRoad, matchesOfficial } from '../scripts/official/at';
import { parseDatex } from '../scripts/official/es';
import { frRoad, normPlace, parseRadarCsv, splitDirection } from '../scripts/official/fr';
import { locateKm, milestonesFrom, parseAspi, parseKm, pointAlong } from '../scripts/official/it';
import { averageClose, nwbFilter } from '../scripts/official/nl';
import { plItems, plRoad, type OppDetail } from '../scripts/official/pl';
import { osmProvenance } from '../src/output';
import { at } from './helpers/synthetic';

const prov = { name: 'X', url: 'https://x', date: '2026-10-27', locatedBy: 'koordinata' } as const;

describe('IT – ASPI-táblázat és km-kövek', () => {
  const html = `<h2>Tratte autostradali con sistema Tutor</h2>
<div class="tratto row"><div class="col-lg-3 d-flex align-items-center"><span class="trat">A1</span> Milano - Bologna</div><div class="col-lg-9"><div class="row intwr even"><div class="col-8 col-lg-4">Lodi Dir. Nord</div><div class="col-4 col-lg-2 text-right hsm">24</div><div class="col-8 col-lg-4">Milano Sud Dir. Nord</div><div class="col-4 col-lg-2 text-right hrm">12,05</div></div></div></div>`;
  it('táblázat: autópálya, tratta, km tizedesvesszővel', () => {
    expect(parseAspi(html)).toEqual([{ autostrada: 'A1', tratta: 'Milano - Bologna', inizio: 'Lodi Dir. Nord', kmInizio: 24, fine: 'Milano Sud Dir. Nord', kmFine: 12.05 }]);
    expect(parseKm('153,400')).toBe(153.4);
  });
  // km-kövek 1 km-enként az x = 0 tengelyen (szintetikus)
  const ms = [0, 1, 2, 3, 4].map((k) => ({ ...at(0, k * 1000), km: 10 + k }));
  it('km → hely: interpoláció két szomszédos km-kő közt', () => {
    const p = locateKm(ms, 12.5);
    expect(typeof p).not.toBe('string');
    expect(haversineM(p as never, at(0, 2500))).toBeLessThan(2);
  });
  it('kívül eső km és ellentmondó km-kövek → nem biztos', () => {
    expect(locateKm(ms, 20)).toMatch(/nincs közrefogó/);
    const bad = [...ms, { ...at(5000, 2000), km: 12 }, { ...at(5000, 3000), km: 13 }];
    expect(locateKm(bad, 12.5)).toMatch(/ellentmondanak/);
  });
  it('vonal menti pont (lineáris vetítéshez)', () => {
    const line = [at(0, 0), at(0, 1000), at(1000, 1000)];
    expect(haversineM(pointAlong(line, 1500), at(500, 1000))).toBeLessThan(1);
    expect(pointAlong(line, 99999)).toEqual(line[2]);
  });
  it('km-kő: csak numerikus distance, és az adott útszám', () => {
    const n = (id: number, tags: Record<string, string>) => ({ type: 'node' as const, id, lat: 45, lon: 9, tags });
    expect(milestonesFrom([n(1, { distance: '12,4', ref: 'A1' }), n(2, { distance: '5', ref: 'A14' }), n(3, { distance: 'x' }), n(4, { distance: '7' })], 'A1').map((m) => m.km)).toEqual([12.4, 7]);
  });
});

describe('PL – OPP-eszközök', () => {
  const dev = (id: number, l1: number, l2: number, extra: Partial<OppDetail['urzadzenie']> = {}, lat = 52, lon = 18): OppDetail => ({
    lat,
    lon,
    urzadzenie: {
      id,
      nrSeryjny: `CAM${id}`,
      stanTechniczny: 'Sprawne',
      mobilne: false,
      lokalizacjaNrDrogi: '19',
      lokalizacjaAdresMiejscowosc: 'Zwierki',
      lokalizacjaDrugiegoPunktu: `${lon + 0.05};${lat}`,
      dataUplywuWazLegalizacji: '2027-01-01',
      dlugoscOdcinka1: l1,
      dlugoscOdcinka2: l2,
      nazwaKierunku1: 'od strony A',
      nazwaKierunku2: 'od strony B',
      ...extra,
    },
    limity: [{ limitOsobowe: '90', limitCiezarowe: '70', typ: { kierunek: '' } }],
  });
  it('útszám: DK / DW / változatlan', () => {
    expect([plRoad('19'), plRoad('132'), plRoad('S7'), plRoad('1120E')]).toEqual(['DK19', 'DW132', 'S7', '1120E']);
  });
  it('kétirányú eszköz: két tétel (mindkét pontsorrend), közös hivatalos hossz', () => {
    const r = plItems([dev(1, 3827, 3823)], '2026-10-27', prov);
    expect(r.listed).toBe(2);
    expect(r.items.map((i) => i.id)).toEqual(['pl-gitd-1-ab', 'pl-gitd-1-ba']);
    expect(r.items[0]!).toMatchObject({ road: 'DK19', speedLimitKmh: 90, officialLengthM: 3825 });
  });
  it('egyirányú eszköz: csak ellentétes párban, különben kimarad (az irány nem dönthető el)', () => {
    const alone = plItems([dev(2, 3000, 0)], '2026-10-27', prov);
    expect(alone.items).toHaveLength(0);
    expect(alone.skipped[0]!.reason).toMatch(/csak egy irányban/);
    const pair = plItems([dev(3, 3000, 0), dev(4, 0, 3000, { nazwaKierunku2: 'od strony C' })], '2026-10-27', prov);
    expect(pair.items).toHaveLength(2);
    expect(pair.listed).toBe(2);
  });
  it('lejárt hitelesítés, irányfüggő határ: kimarad, irányonként egy sorral', () => {
    const r = plItems(
      [dev(5, 3000, 3000, { dataUplywuWazLegalizacji: '2025-12-25' }), { ...dev(6, 3000, 3000), limity: [{ limitOsobowe: '110', limitCiezarowe: null, typ: { kierunek: 'w stronę X' } }] }],
      '2026-10-27',
      prov,
    );
    expect(r.items).toHaveLength(0);
    expect(r.skipped).toHaveLength(4);
    expect(r.skipped[0]!.reason).toMatch(/hitelesítés lejárt/);
    expect(r.skipped[2]!.reason).toMatch(/irányfüggő/);
  });
});

describe('FR – data.gouv CSV és radartérkép', () => {
  it('csak az ETVM sorok, szóközös fejléccel', () => {
    const csv = 'Numéro de radar;Type de radar;Date de mise en service;VMA ;Latitude; Longitude\r\n12001;ETD;31/10/2011 00:00;70;+45.361;+4.2526\r\n20006;ETVM;25/08/2012 00:00;70;+47.21546;+6.01039\r\n';
    expect(parseRadarCsv(csv)).toEqual([{ id: '20006', vma: 70, lat: 47.21546, lon: 6.01039 }]);
  });
  it('útszám, település, irány', () => {
    expect([frRoad('RN 57'), frRoad('RD213'), frRoad('A10'), frRoad('RM6007')]).toEqual(['N57', 'D213', 'A10', 'M6007']);
    expect(normPlace('Saint-Brevin-les-Pins')).toBe(normPlace('St Brevin les Pins'));
    expect(splitDirection('Vallorbe vers Nancy')).toEqual(['Vallorbe', 'Nancy']);
    expect(splitDirection('PR croissant')).toBeNull();
  });
});

describe('ES – DATEX II', () => {
  const pt = (lat: number, lon: number) => `<_0:pointCoordinates><_0:latitude>${lat}</_0:latitude><_0:longitude>${lon}</_0:longitude></_0:pointCoordinates>`;
  const ref = (kind: string, km: number) =>
    `<_0:referencePoint${kind}Location><_0:referencePoint><_0:administrativeArea><_0:value>ZARAGOZA</_0:value></_0:administrativeArea><_0:roadNumber>Z-40</_0:roadNumber><_0:referencePointDistance>${km}</_0:referencePointDistance><_0:directionNamed>MADRID</_0:directionNamed></_0:referencePoint></_0:referencePoint${kind}Location>`;
  const xml = `<_0:publicationTime>2025-12-18T10:00:00</_0:publicationTime><_0:predefinedLocationSet id="GUID_Inventario_CinemometrosVelocidadMedia">
<_0:predefinedLocation id="GUID_CVM_1"><_0:predefinedLocation><_0:tpeglinearLocation><_0:to>${pt(41.6192, -0.9496)}</_0:to><_0:from>${pt(41.6088, -0.915697)}</_0:from></_0:tpeglinearLocation><_0:referencePointLinear>${ref('Primary', 26600)}${ref('Secondary', 29700)}</_0:referencePointLinear></_0:predefinedLocation></_0:predefinedLocation>
</_0:predefinedLocationSet>`;
  it('from → to, km ini/fin, út, irány', () => {
    const r = parseDatex(xml);
    expect(r.publicationTime).toBe('2025-12-18T10:00:00');
    expect(r.tramos).toEqual([
      { id: 'GUID_CVM_1', road: 'Z-40', from: { lat: 41.6088, lon: -0.915697 }, to: { lat: 41.6192, lon: -0.9496 }, kmIni: 26.6, kmFin: 29.7, directionNamed: 'MADRID', province: 'ZARAGOZA' },
    ]);
  });
});

describe('NL – NWB', () => {
  it('útszám-szűrő: rijksweg 3 jegyű wegnummer + route, provinciális N-út', () => {
    expect(nwbFilter('A7')).toBe("wegnummer='007' AND bst_code='HR' AND routeltr='A' AND routenr='7'");
    expect(nwbFilter('N11')).toBe("wegnummer='011' AND bst_code='HR' AND routeltr='N' AND routenr='11'");
    expect(nwbFilter('N639')).toBe("wegnummer='N639' AND bst_code='HR' AND routeltr='N' AND routenr='639'");
  });
  it('hectometerpont: két pályatest átlaga, szórásnál nem egyértelmű', () => {
    expect(typeof averageClose([at(0, 0), at(30, 0)])).toBe('object');
    expect(averageClose([at(0, 0), at(900, 0)])).toMatch(/szétszórtak/);
    expect(averageClose([])).toMatch(/nincs ilyen/);
  });
});

describe('AT – összevetés', () => {
  const s: Section = { id: 'osm-1', country: 'AT', road: 'A22', direction: '', start: at(0, 0), end: at(0, 2300), lengthM: 2300, speedLimitKmh: 80, source: 'osm', verified: false };
  it('útszám és egyezés (mindkét irányú rendeletnél fordítva is)', () => {
    expect(atRoad('A 22 Donauufer Autobahn')).toBe('A22');
    expect(matchesOfficial(s, at(0, 100), at(0, 2400), 2310, false)).toBe(true);
    expect(matchesOfficial(s, at(0, 2400), at(0, 100), 2310, false)).toBe(false);
    expect(matchesOfficial(s, at(0, 2400), at(0, 100), 2310, true)).toBe(true);
    expect(matchesOfficial(s, at(0, 100), at(0, 2400), 4000, true)).toBe(false);
  });
});

describe('OSM-forrás', () => {
  it('reláció / út URL-je és a nap', () => {
    expect(osmProvenance('osm-17820940', '2026-10-26T22:05:03Z')).toEqual({ name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/relation/17820940', date: '2026-10-26', locatedBy: 'koordinata' });
    expect(osmProvenance('osm-w123-456r', '2026-10-26').url).toBe('https://www.openstreetmap.org/way/123');
  });
});
