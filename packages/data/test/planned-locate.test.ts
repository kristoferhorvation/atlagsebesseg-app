import { describe, expect, it } from 'vitest';
import { haversineM, LocalProjection } from '@atlagsebesseg/core';
import type { OsmElement, OsmWay, OverpassResponse } from '../src/overpass';
import { assembleRings, chainParts, kreszDefault, locateByKm, locateInSettlement, maxspeedKmh, pickMaxspeed, pointInArea, settlementSubset, type Part } from '../src/planned/locate';
import { parseLocationLine } from '../src/planned/parse';

const proj = new LocalProjection({ lat: 47.2, lon: 18.4 });
const at = (x: number, y: number) => proj.fromXY({ x, y });
let nextNode = 1;

/** Út kelet–nyugati irányban y magasságban, x0 → x1 (méter), 100 m-es csomópontokkal. */
function way(id: number, x0: number, x1: number, y: number, tags: Record<string, string>): OsmWay {
  const xs: number[] = [];
  for (let x = x0; x0 < x1 ? x <= x1 : x >= x1; x += x0 < x1 ? 100 : -100) xs.push(x);
  return { type: 'way', id, nodes: xs.map(() => nextNode++), geometry: xs.map((x) => at(x, y)), tags: { highway: 'primary', ...tags } };
}

/** Észak–déli út x-nél. */
function wayNS(id: number, x: number, y0: number, y1: number, tags: Record<string, string>): OsmWay {
  const ys: number[] = [];
  for (let y = y0; y <= y1; y += 100) ys.push(y);
  return { type: 'way', id, nodes: ys.map(() => nextNode++), geometry: ys.map((y) => at(x, y)), tags: { highway: 'residential', ...tags } };
}

/** A település határa: x ∈ [0, 2000] – a határon belüli csomópontok azonosítói is a válaszban. */
function settlementResponse(ways: OsmWay[], inside = (x: number) => x >= -0.5 && x <= 2000.5): OverpassResponse {
  const nodes: OsmElement[] = [];
  for (const w of ways)
    w.nodes.forEach((id, i) => {
      const xy = proj.toXY(w.geometry![i]!);
      if (inside(xy.x)) nodes.push({ type: 'node', id, lat: 0, lon: 0 });
    });
  return { elements: [...ways, ...nodes] };
}

const lenM = (pts: { lat: number; lon: number }[]) => pts.reduce((s, p, i) => (i ? s + haversineM(pts[i - 1]!, p) : 0), 0);

describe('település + útszám („Budaörs, M1”)', () => {
  it('az út csak a település határán belüli része; két pályatest → két vonal', () => {
    const north = way(1, -1500, 3500, 15, { highway: 'motorway', ref: 'M1', maxspeed: '130', oneway: 'yes' });
    const south = way(2, 3500, -1500, -15, { highway: 'motorway', ref: 'M1', maxspeed: '130', oneway: 'yes' });
    const other = way(3, -1500, 3500, 500, { ref: '1' });
    const line = parseLocationLine('Budaörs, M1 autópálya', 'Pest', ['Budaörs']);
    const r = locateInSettlement(line, settlementResponse([north, south, other]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.located.lines).toHaveLength(2);
    for (const l of r.located.lines) {
      expect(lenM(l)).toBeCloseTo(2000, -1);
      for (const p of l) expect(proj.toXY(p).x).toBeGreaterThanOrEqual(-1);
    }
    expect(r.located).toMatchObject({ speedLimitKmh: 130, limitSource: 'osm' });
  });

  it('az út nem fut a településen → kimarad okkal', () => {
    const line = parseLocationLine('Budaörs, M1 autópálya', 'Pest', ['Budaörs']);
    const r = locateInSettlement(line, settlementResponse([way(1, 3000, 5000, 0, { ref: 'M1' })]));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('M1') });
  });
});

describe('település + utca („Kecskemét, Nagykőrösi út”)', () => {
  it('az utca vonala a településen; több darab összefűzve; határ KRESZ szerint, ha nincs maxspeed', () => {
    const a = way(10, 0, 600, 0, { highway: 'secondary', name: 'Nagykőrösi út' });
    const b: OsmWay = { ...way(11, 600, 1200, 0, { highway: 'secondary', name: 'Nagykőrösi út' }) };
    b.nodes[0] = a.nodes[a.nodes.length - 1]!; // közös csomópont
    const decoy = way(12, 0, 600, 300, { name: 'Nagykőrösi utca' });
    const line = parseLocationLine('Kecskemét Nagykőrösi út 12.', 'Bács-Kiskun', ['Kecskemét']);
    const r = locateInSettlement(line, settlementResponse([a, b, decoy]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.located.lines).toHaveLength(1);
    expect(lenM(r.located.lines[0]!)).toBeCloseTo(1200, -1);
    expect(r.located).toMatchObject({ speedLimitKmh: 50, limitSource: 'kresz_default' });
  });

  it('„Kossuth utca” → „Kossuth Lajos utca”, ha egyértelmű; két jelöltnél kimarad', () => {
    const line = parseLocationLine('Kistelek Kossuth utca 88.', 'Csongrád-Csanád', ['Kistelek']);
    const one = locateInSettlement(line, settlementResponse([way(1, 0, 500, 0, { name: 'Kossuth Lajos utca' })]));
    expect(one.ok).toBe(true);
    const two = locateInSettlement(line, settlementResponse([way(1, 0, 500, 0, { name: 'Kossuth Lajos utca' }), way(2, 0, 500, 300, { name: 'Kossuth Ferenc utca' })]));
    expect(two).toEqual({ ok: false, reason: expect.stringContaining('több utcára') });
  });

  it('utcatípus-eltérés („Fő utca” ~ „Fő út”), ha egyértelmű; két jelöltnél kimarad', () => {
    const line = parseLocationLine('Vecsés Fő utca 9.', 'Pest', ['Vecsés']);
    expect(locateInSettlement(line, settlementResponse([way(1, 0, 500, 0, { name: 'Fő út' })])).ok).toBe(true);
    const two = locateInSettlement(line, settlementResponse([way(1, 0, 500, 0, { name: 'Fő út' }), way(2, 0, 500, 300, { name: 'Fő tér' })]));
    expect(two).toEqual({ ok: false, reason: expect.stringContaining('több utcára') });
  });

  it('nincs ilyen utca → kimarad', () => {
    const line = parseLocationLine('Kecskemét Nagykőrösi út 12.', 'Bács-Kiskun', ['Kecskemét']);
    const r = locateInSettlement(line, settlementResponse([way(1, 0, 500, 0, { name: 'Kossuth utca' })]));
    expect(r.ok).toBe(false);
  });
});

describe('kereszteződés', () => {
  it('mindkét ág a csomópont 300 m-es körzetében', () => {
    const ew = way(20, 0, 2000, 0, { name: 'Ifjúság utca', highway: 'residential' });
    const ns = wayNS(21, 1000, -800, 800, { name: 'Ady Endre utca' });
    ns.nodes[8] = ew.nodes[10]!; // közös csomópont a (1000, 0) pontban
    const line = parseLocationLine('Tác Ady E. - Ifjúság u. kereszteződése', 'Fejér', ['Tác']);
    const r = locateInSettlement(line, settlementResponse([ew, ns]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const l of r.located.lines) for (const p of l) expect(haversineM(p, at(1000, 0))).toBeLessThanOrEqual(301);
    const total = r.located.lines.reduce((s, l) => s + lenM(l), 0);
    expect(total).toBeGreaterThan(1100); // 2 × 600 m (a sűrítés miatt ~±20 m)
    expect(total).toBeLessThan(1250);
  });

  it('típusszó nélküli ág, ha a településen több ilyen nevű utca van → kimarad', () => {
    const ew = way(20, 0, 2000, 0, { name: 'Ifjúság utca' });
    const a = wayNS(21, 1000, -800, 800, { name: 'Ady Endre utca' });
    const b = wayNS(22, 1500, -800, 800, { name: 'Ady Endre tér' });
    a.nodes[8] = ew.nodes[10]!;
    const line = parseLocationLine('Tác Ady E. - Ifjúság u. kereszteződése', 'Fejér', ['Tác']);
    const r = locateInSettlement(line, settlementResponse([ew, a, b]));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('több utcára') });
  });
});

describe('útszám + km-szelvény (km-kövek)', () => {
  const road = way(30, 0, 5000, 0, { ref: '7', maxspeed: '90' });
  const stone = (km: number, x: number, dy = 8): OsmElement => ({ type: 'node', id: 9000 + km, ...at(x, dy), tags: { highway: 'milestone', distance: String(km) } });
  const line = parseLocationLine('7-es főút 89+730 km-szelvény', 'Fejér', []);

  it('két szomszédos kő → a köztük lévő útszakasz', () => {
    const r = locateByKm(line, line.km[0]!, { elements: [road, stone(89, 1000), stone(90, 2000)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xs = r.located.lines.flat().map((p) => proj.toXY(p).x);
    expect(Math.min(...xs)).toBeGreaterThan(900);
    expect(Math.max(...xs)).toBeLessThan(2100);
    expect(r.located.speedLimitKmh).toBe(90);
  });

  it('csak a legközelebbi kő → 600 m-es körzet', () => {
    const r = locateByKm(line, line.km[0]!, { elements: [road, stone(90, 2000)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const p of r.located.lines.flat()) expect(haversineM(p, at(2000, 8))).toBeLessThanOrEqual(601);
  });

  it('nincs kő / a kő nem az úton van / két azonos számú kő messze egymástól → kimarad', () => {
    expect(locateByKm(line, line.km[0]!, { elements: [road] }).ok).toBe(false);
    expect(locateByKm(line, line.km[0]!, { elements: [road, stone(90, 2000, 200)] }).ok).toBe(false);
    const twice = locateByKm(line, line.km[0]!, { elements: [road, stone(89, 1000), stone(90, 2000), { ...(stone(90, 4500) as object), id: 1 } as OsmElement] });
    expect(twice).toEqual({ ok: false, reason: expect.stringContaining('több') });
  });
});

describe('sebességhatár', () => {
  const part = (len: number, tags: Record<string, string>): Part => ({ points: [at(0, 0), at(len, 0)], startId: -1, endId: -2, tags });

  it('több maxspeed → a vonal mentén leggyakoribb (hossz szerint); döntetlennél a kisebb', () => {
    expect(pickMaxspeed([part(300, { maxspeed: '50' }), part(900, { maxspeed: '70' }), part(200, { maxspeed: '50' })])).toBe(70);
    expect(pickMaxspeed([part(500, { maxspeed: '90' }), part(500, { maxspeed: '70' })])).toBe(70);
    expect(pickMaxspeed([part(500, { highway: 'primary' })])).toBeNull();
  });

  it('magyar jogszabályi alapértékek és irányonkénti címke', () => {
    expect(maxspeedKmh('HU:urban')).toBe(50);
    expect(maxspeedKmh('HU:rural')).toBe(90);
    expect(maxspeedKmh('signals')).toBeNull();
    expect(pickMaxspeed([part(100, { 'maxspeed:forward': '60', 'maxspeed:backward': '60' })])).toBe(60);
  });

  it('KRESZ-alapérték: autópálya 130, autóút 110, lakott 50, lakott kívül 90', () => {
    expect(kreszDefault([part(100, { highway: 'motorway' })], null, false)).toBe(130);
    expect(kreszDefault([part(100, { highway: 'trunk', motorroad: 'yes' })], null, false)).toBe(110);
    expect(kreszDefault([part(100, { highway: 'primary' })], true, false)).toBe(50);
    expect(kreszDefault([part(100, { highway: 'primary' })], false, false)).toBe(90);
    expect(kreszDefault([part(100, { highway: 'primary' })], null, false)).toBe(90);
    expect(kreszDefault([part(100, { highway: 'tertiary' })], null, true)).toBe(50);
    expect(kreszDefault([part(100, { highway: 'living_street' })], null, true)).toBe(20);
  });
});

describe('darabok összefűzése', () => {
  it('közös végpontnál, fordított irányú darabbal is', () => {
    const p1: Part = { points: [at(0, 0), at(100, 0)], startId: 1, endId: 2, tags: {} };
    const p2: Part = { points: [at(200, 0), at(100, 0)], startId: 3, endId: 2, tags: {} };
    const p3: Part = { points: [at(500, 0), at(600, 0)], startId: 7, endId: 8, tags: {} };
    const out = chainParts([p1, p2, p3]);
    expect(out).toHaveLength(2);
    expect(lenM(out[0]!.points)).toBeCloseTo(200, 0);
  });
});

describe('település-határ (megyei lekérésből, helyben vágva)', () => {
  const ring = [at(0, 0), at(1000, 0), at(1000, 1000), at(0, 1000), at(0, 0)];
  const hole = [at(400, 400), at(600, 400), at(600, 600), at(400, 600), at(400, 400)];
  const area = {
    relId: 1,
    name: 'Próba',
    rings: assembleRings({
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: ring.slice(0, 3) },
        { type: 'way', ref: 2, role: 'outer', geometry: [...ring.slice(2)].reverse() },
        { type: 'way', ref: 3, role: 'inner', geometry: hole },
      ],
    }),
  };

  it('a darabokból zárt gyűrű lesz; a belső gyűrű (lyuk) kívül számít', () => {
    expect(area.rings.outer).toHaveLength(1);
    expect(area.rings.inner).toHaveLength(1);
    expect(pointInArea(at(200, 200), area)).toBe(true);
    expect(pointInArea(at(500, 500), area)).toBe(false);
    expect(pointInArea(at(1200, 200), area)).toBe(false);
  });

  it('a település „saját” válasza: csak a határon belüli csomópontok', () => {
    const w = way(40, -500, 1500, 200, { name: 'Fő utca' });
    const sub = settlementSubset({ elements: [w, way(41, 3000, 4000, 200, { name: 'Fő utca' })] }, area);
    expect(sub.elements.filter((e) => e.type === 'way').map((e) => e.id)).toEqual([40]);
    const r = locateInSettlement(parseLocationLine('Próba Fő utca 3.', 'Fejér', ['Próba']), sub);
    expect(r.ok).toBe(true);
    // a határvonalra eső csomópont (x = 0 / 1000) bármelyik oldalra eshet
    if (r.ok) expect(lenM(r.located.lines[0]!)).toBeGreaterThan(890);
    if (r.ok) expect(lenM(r.located.lines[0]!)).toBeLessThan(1001);
  });
});
