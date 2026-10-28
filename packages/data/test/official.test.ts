import { describe, expect, it } from 'vitest';
import { consistentMaxspeed, evaluateOfficial, isOsmDuplicate, mergeOfficialWithOsm, normalizeRef, overlapShare, refMatches, type OfficialItem } from '../src/official';
import type { Section } from '@atlagsebesseg/core';
import { simplifyGeometry } from '../src/routeBetween';
import { at, graph } from './helpers/synthetic';

const prov = { name: 'Polizia di Stato', url: 'https://www.poliziadistato.it/', date: '2026-08', locatedBy: 'km_szelveny' } as const;

/** Az északi pályatest mentén (x = +15) 0 → 10 km. */
const item = (extra: Partial<OfficialItem> = {}): OfficialItem => ({
  id: 'it-test-1',
  country: 'IT',
  road: 'A22',
  direction: 'Verona → Brennero',
  label: 'A22 Bolzano Sud – Bolzano Nord',
  start: at(15, 0),
  end: at(15, 10000),
  speedLimitKmh: 130,
  provenance: prov,
  ...extra,
});

describe('útszám-egyezés', () => {
  it('szóköz, kötőjel, kis-nagybetű nem számít; több ref közül bármelyik', () => {
    expect(refMatches('A22', 'A 22;E45', 'IT')).toBe(true);
    expect(refMatches('AP-7', 'AP7', 'ES')).toBe(true);
    expect(refMatches('A2', 'A22', 'IT')).toBe(false);
    expect(refMatches('A1', undefined, 'IT')).toBe(false);
  });
  it('lengyel országos/vajdasági út: DK7 = OSM „7”, DW132 = „132”', () => {
    expect(normalizeRef('DK7', 'PL')).toBe('7');
    expect(refMatches('DK7', '7', 'PL')).toBe(true);
    expect(refMatches('S7', '7', 'PL')).toBe(false);
    expect(refMatches('DW132', '132', 'PL')).toBe(true);
  });
});

describe('evaluateOfficial', () => {
  it('jó tétel: hivatalos, ellenőrzött, forrással, a helyes pályatesten', () => {
    const r = evaluateOfficial(item(), graph);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.section).toMatchObject({ source: 'hivatalos', verified: true, provenance: prov, speedLimitKmh: 130, road: 'A22' });
    expect(Math.abs(r.section.lengthM - 10000)).toBeLessThan(5);
    expect(r.section.geometry!.every((p) => Math.abs(p.lon - at(15, 0).lon) < 1e-4)).toBe(true);
  });
  it('a hivatalos hossz nyer, ha egyezik', () => {
    const r = evaluateOfficial(item({ officialLengthM: 10200 }), graph);
    expect(r.ok && r.section.lengthM).toBe(10200);
  });
  it('kimarad: a hivatalos hossz túl messze van az útvonalétól', () => {
    const r = evaluateOfficial(item({ officialLengthM: 14000 }), graph);
    expect(!r.ok && r.skip.reason).toMatch(/hivatalos hossz 14\.00 km/);
  });
  it('kimarad: rossz útszám (a geometria nem a megadott úton fut)', () => {
    const r = evaluateOfficial(item({ road: 'A1' }), graph);
    expect(!r.ok && r.skip.reason).toMatch(/A1 úton/);
  });
  it('kimarad: túl rövid / túl hosszú', () => {
    expect(evaluateOfficial(item({ end: at(15, 300) }), graph).ok).toBe(false);
  });
  it('kimarad: a kapu nincs az úton', () => {
    const r = evaluateOfficial(item({ start: at(600, 0) }), graph);
    expect(!r.ok && r.skip.reason).toMatch(/60 m-en belül/);
  });
  it('kimarad: fordított irány a pályatesten nem jár (egyirányú), nincs útvonal', () => {
    const r = evaluateOfficial(item({ start: at(15, 10000), end: at(15, 0) }), graph, { snapRadiusM: 5 });
    expect(r.ok).toBe(false);
  });
  it('határ nélkül: az OSM maxspeed, ha egyértelmű (megjegyzéssel)', () => {
    const r = evaluateOfficial(item({ speedLimitKmh: null }), graph);
    expect(r.ok && r.section.speedLimitKmh).toBe(130);
    expect(r.ok && r.note).toMatch(/OSM/);
    expect(r.ok && r.section.limitSource).toBe('osm');
    const h = evaluateOfficial(item(), graph);
    expect(h.ok && h.section.limitSource).toBe('hivatalos');
  });
  it('az OSM-határ csak egyértelmű többségnél', () => {
    expect(consistentMaxspeed([{ lengthM: 9, tags: { maxspeed: '130' } }, { lengthM: 1, tags: { maxspeed: '110' } }])).toBe(130);
    expect(consistentMaxspeed([{ lengthM: 6, tags: { maxspeed: '130' } }, { lengthM: 4, tags: { maxspeed: '110' } }])).toBeNull();
    expect(consistentMaxspeed([{ lengthM: 6, tags: {} }])).toBeNull();
  });
});

describe('simplifyGeometry', () => {
  it('egyenesen csak a két vég marad, a kanyar pontja megmarad', () => {
    expect(simplifyGeometry([at(0, 0), at(1, 500), at(0, 1000)])).toHaveLength(2);
    expect(simplifyGeometry([at(0, 0), at(200, 500), at(0, 1000)])).toHaveLength(3);
  });
});

describe('hivatalos + OSM összefésülés (duplikátum-szabály)', () => {
  const sec = (id: string, x: number, y0: number, y1: number, extra: Partial<Section> = {}): Section => ({
    id, country: 'IT', road: 'A22', direction: '', start: at(x, y0), end: at(x, y1), lengthM: Math.abs(y1 - y0),
    speedLimitKmh: 130, source: 'osm', verified: false, geometry: [at(x, y0), at(x, y1)], ...extra,
  });
  const official = sec('it-hiv', 15, 0, 10000, { source: 'hivatalos', verified: true });
  it('átfedés aránya', () => {
    expect(overlapShare([at(15, 0), at(15, 10000)], [at(15, 2000), at(15, 12000)])).toBeCloseTo(0.8, 1);
    expect(overlapShare([at(15, 0), at(15, 1000)], [at(200, 0), at(200, 1000)])).toBe(0);
  });
  it('duplikátum: ugyanaz az út, irány, ≥ 70% átfedés', () => {
    expect(isOsmDuplicate(sec('o1', 16, 1000, 9000), official)).toBe(true);
    expect(isOsmDuplicate(sec('o2', 16, 6000, 16000), official)).toBe(false); // csak 40%
    expect(isOsmDuplicate(sec('o3', 16, 9000, 1000), official)).toBe(false); // ellenirány
    expect(isOsmDuplicate(sec('o4', 16, 1000, 9000, { road: 'SS12' }), official)).toBe(false); // más út
  });
  it('a nem duplikátum OSM-szakasz nem ellenőrzöttként marad', () => {
    const r = mergeOfficialWithOsm([official], [sec('o1', 16, 1000, 9000), sec('o2', 200, 0, 5000, { road: 'SS12', verified: true })]);
    expect(r.duplicates).toEqual([{ osm: 'o1', official: 'it-hiv' }]);
    expect(r.sections.map((s) => [s.id, s.verified])).toEqual([['it-hiv', true], ['o2', false]]);
    expect(r.sections.find((s) => s.id === 'o2')!.limitSource).toBe('osm');
  });
});
