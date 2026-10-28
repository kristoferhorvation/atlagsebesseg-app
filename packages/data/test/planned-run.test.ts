import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalProjection } from '@atlagsebesseg/core';
import type { OsmElement, OverpassResponse } from '../src/overpass';
import { areaId, simplifyRing } from '../src/planned/locate';
import { rowId, runPlannedChecks, type PlannedCheckRow, type PlannedDeps, type PlannedStore } from '../src/planned/run';

const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', 'police', f), 'utf8');
const ARTICLE = 'https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet/speedmarathon-helyszinek-2026';
const FEJER_PDF = 'https://www.police.hu/sites/default/files/Fej%C3%A9r%20VMRFK%20helysz%C3%ADnek.pdf';

const proj = new LocalProjection({ lat: 47.19, lon: 18.41 });
const SZFV = 1001;

/** Hamis Overpass: Fejér megye két településsel (Székesfehérvár határa geometriával); a megyében a Palotai út. */
function overpass(query: string): OverpassResponse {
  const square = (x0: number, y0: number, x1: number, y1: number) =>
    [proj.fromXY({ x: x0, y: y0 }), proj.fromXY({ x: x1, y: y0 }), proj.fromXY({ x: x1, y: y1 }), proj.fromXY({ x: x0, y: y1 }), proj.fromXY({ x: x0, y: y0 })];
  if (query.includes('"name"="Fejér megye"')) {
    // a határ két útból áll össze (a gyűrű-összefűzés is próba alatt)
    const ring = square(-100, -100, 700, 100);
    return {
      elements: [
        { type: 'relation', id: 22255, members: [], tags: { name: 'Fejér megye', admin_level: '6' } },
        {
          type: 'relation',
          id: SZFV,
          members: [
            { type: 'way', ref: 1, role: 'outer', geometry: ring.slice(0, 3) },
            { type: 'way', ref: 2, role: 'outer', geometry: ring.slice(2).reverse() },
          ],
          tags: { name: 'Székesfehérvár', admin_level: '8' },
        },
        { type: 'relation', id: 1002, members: [], tags: { name: 'Tác', admin_level: '8' } },
      ],
    };
  }
  if (query.includes(`area(id:${areaId(22255)})`) && !query.includes('milestone')) {
    // a Palotai út a határon túl is folytatódik (x = 1200-ig): csak a határon belüli rész marad
    const xs = [0, 200, 400, 600, 900, 1200];
    return {
      elements: [
        { type: 'way', id: 500, nodes: xs.map((_, i) => 11 + i), geometry: xs.map((x) => proj.fromXY({ x, y: 0 })), tags: { highway: 'secondary', name: 'Palotai út', maxspeed: '50' } },
      ],
    };
  }
  return { elements: [] };
}

function memoryStore() {
  const calls = { upserts: [] as PlannedCheckRow[], expired: [] as string[], stale: [] as [string, readonly string[]][] };
  const store: PlannedStore = {
    upsert: async (rows) => void calls.upserts.push(...rows),
    deleteExpired: async (iso) => (calls.expired.push(iso), 0),
    deleteStale: async (src, ids) => (calls.stale.push([src, ids]), 0),
    logRun: async () => undefined,
  };
  return { store, calls };
}

function deps(today: string, opts: { listing?: string } = {}): PlannedDeps & { calls: ReturnType<typeof memoryStore>['calls'] } {
  const { store, calls } = memoryStore();
  return {
    fetchText: async (url) => {
      if (url === ARTICLE) return fx('speedmarathon-2026.html');
      if (opts.listing !== undefined) return opts.listing;
      throw new Error(`váratlan URL: ${url}`);
    },
    fetchBytes: async (url) => new TextEncoder().encode(url),
    // a mellékletek „szövege”: Fejér a valódi PDF-szöveg, a többi csak a fejléc
    pdfText: async (bytes) => {
      const url = new TextDecoder().decode(bytes);
      return url === FEJER_PDF ? fx('sm2026-fejer.txt') : 'Speedmarathon 2026. ellenőrzési helyszínek\n';
    },
    overpass: async (q) => overpass(q),
    store,
    now: () => new Date(`${today}T12:00:00Z`),
    calls,
  };
}

const listingWith = (published: string, title: string) =>
  `<article><header><h1><a href="${ARTICLE.replace('https://www.police.hu', '')}" hreflang="hu">${title}</a></h1></header>` +
  `<footer><time datetime="${published}">x</time><span class="location">ORFK Kommunikációs Szolgálat</span></footer>` +
  `<div class="lead-text"><p>A rendőrség kijelölte a helyszíneket.</p></div></article>`;

describe('tervezett mérések – zóna (egész település)', () => {
  /** Mint a `deps`, de a Fejér-melléklet csak településeket nevez meg. */
  const zoneDeps = (today: string) => {
    const d = deps(today);
    d.pdfText = async (bytes) =>
      new TextDecoder().decode(bytes) === FEJER_PDF
        ? 'Fejér VMRFK helyszínek\nSzékesfehérvár\nSzékesfehérvár mozgó ellenőrzés\nTác belterülete álló-mozgó ellenőrzés\nSzékesfehérvár Kossuth sgt.\n'
        : 'Speedmarathon 2026. ellenőrzési helyszínek\n';
    return d;
  };

  it('csak települést adó sorból zóna-sor: a település határa sokszögként, a Székesfehérvár kétféle megfogalmazása egy sor', async () => {
    const d = zoneDeps('2026-04-14');
    const s = await runPlannedChecks(d, { articleUrls: [ARTICLE] });
    expect(s.zones).toBe(1);
    expect(s.counties['Fejér']!.rows).toBe(1);
    const row = d.calls.upserts[0]!;
    expect(row).toMatchObject({
      settlement: 'Székesfehérvár',
      road_ref: null,
      description: 'Székesfehérvár',
      valid_from: '2026-04-15T04:00:00.000Z',
      valid_to: '2026-04-19T21:59:59.000Z',
      source_url: FEJER_PDF,
    });
    expect(row.geometry.type).toBe('Polygon');
    const ring = (row.geometry.coordinates as [number, number][][])[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const xs = ring.map(([lon, lat]) => proj.toXY({ lat, lon }).x);
    expect(Math.min(...xs)).toBeCloseTo(-100, -1);
    expect(Math.max(...xs)).toBeCloseTo(700, -1);
    expect(row.min_lng).toBeLessThan(row.max_lng);
    expect(d.calls.stale).toContainEqual([FEJER_PDF, [row.id]]);
  });

  it('a kimaradó zóna okkal listázva: nincs határ-geometria (Tác); a „Kossuth sgt.” nem zóna', async () => {
    const s = await runPlannedChecks(zoneDeps('2026-04-14'), { articleUrls: [ARTICLE] });
    const sk = s.counties['Fejér']!.skipped;
    expect(sk).toContainEqual({ line: 'Tác belterülete álló-mozgó ellenőrzés', reason: expect.stringContaining('határa nincs meg') });
    expect(sk).toContainEqual({ line: 'Székesfehérvár Kossuth sgt.', reason: expect.stringContaining('csak település') });
  });

  it('a határ egyszerűsítése: az egyenes menti pontok elhagyva, a sarkok és a zárás megmarad', () => {
    const sq = [0, 100, 200, 300].map((x) => proj.fromXY({ x, y: 0 }));
    const ring = [...sq, proj.fromXY({ x: 300, y: 300 }), proj.fromXY({ x: 0, y: 300 }), sq[0]!];
    const out = simplifyRing(ring, 25);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual(out[out.length - 1]);
  });
});

describe('tervezett mérések – egy futás', () => {
  it('Speedmarathon 2026 a közzététel napján: Fejérben a Palotai út elhelyezve, a többi sor okkal kimarad', async () => {
    const d = deps('2026-04-14');
    const s = await runPlannedChecks(d, { articleUrls: [ARTICLE] });
    expect(s.articles[0]).toMatchObject({ status: 'feldolgozva', period: '2026-04-15 – 2026-04-16 (ápr 15. 6:00 – ápr 16. 6:00)' });
    expect(s.counties['Fejér']!.rows).toBe(1);
    expect(s.counties['Fejér']!.skipped.length).toBeGreaterThan(40);
    expect(s.counties['Fejér']!.skipped.find((x) => x.line === 'Ceglédbercel belterülete álló-mozgó ellenőrzés')).toBeUndefined();
    const row = d.calls.upserts[0]!;
    expect(row).toMatchObject({
      county: 'Fejér',
      settlement: 'Székesfehérvár',
      road_ref: 'Palotai út',
      description: 'Székesfehérvár Palotai út 156.',
      speed_limit_kmh: 50,
      limit_source: 'osm',
      valid_from: '2026-04-15T04:00:00.000Z',
      valid_to: '2026-04-19T21:59:59.000Z',
      time_window: 'ápr 15. 6:00 – ápr 16. 6:00',
      source_url: FEJER_PDF,
    });
    expect(row.geometry.type).toBe('LineString');
    // a határon belüli rész: x = 0 … 600 m
    const xs = (row.geometry.coordinates as [number, number][]).map(([lon, lat]) => proj.toXY({ lat, lon }).x);
    expect(Math.max(...xs)).toBeLessThan(700);
    expect(Math.min(...xs)).toBeGreaterThan(-1);
    expect(row.id).toBe(rowId(FEJER_PDF, 'Székesfehérvár Palotai út 156.'));
    // a forrás régi sorai törlődnek (ami most nincs benne), a lejártak is
    expect(d.calls.stale).toContainEqual([FEJER_PDF, [row.id]]);
    expect(d.calls.expired).toEqual(['2026-04-14T12:00:00.000Z']);
  });

  it('a kimaradt sorok név (szó szerinti sor) és ok szerint listázva', async () => {
    const s = await runPlannedChecks(deps('2026-04-14'), { articleUrls: [ARTICLE] });
    const sk = s.counties['Fejér']!.skipped;
    expect(sk).toContainEqual({ line: 'Kőszárhegy Fő u. 112.', reason: expect.stringContaining('ismeretlen település') });
    expect(sk).toContainEqual({ line: 'Tác Ady E. - Ifjúság u. kereszteződése', reason: expect.stringContaining('nincs meg') });
    expect(sk.every((x) => x.reason.length > 5)).toBe(true);
  });

  it('a hét vége után a cikk lejárt: nincs új sor, a lejártak törlődnek', async () => {
    const d = deps('2026-04-20');
    const s = await runPlannedChecks(d, { articleUrls: [ARTICLE] });
    expect(s.articles[0]!.status).toBe('lejárt');
    expect(s.rows).toBe(0);
    expect(d.calls.upserts).toEqual([]);
    expect(d.calls.expired).toHaveLength(1);
  });

  it('hírlista: friss, helyszínre utaló hír a jelölt; régi nem', async () => {
    const fresh = deps('2026-04-14', { listing: listingWith('2026-04-14 11:30', 'Speedmarathon helyszínek 2026') });
    expect((await runPlannedChecks(fresh)).candidates).toBe(1);
    const old = deps('2026-06-30', { listing: listingWith('2026-04-14 11:30', 'Speedmarathon helyszínek 2026') });
    expect((await runPlannedChecks(old)).candidates).toBe(0);
    const other = deps('2026-04-14', { listing: listingWith('2026-04-14 11:30', 'Közlekedésrendészeti hírek') });
    expect((await runPlannedChecks(other)).candidates).toBe(0);
  });

  it('megváltozott hírlista-szerkezet (0 hír) → hiba, nem csendes üres eredmény', async () => {
    await expect(runPlannedChecks(deps('2026-04-14', { listing: '<html><body>új dizájn</body></html>' }))).rejects.toThrow(/0 hírt/);
  });

  it('időkeret: a fel nem dolgozott sorok a következő futásé, és ilyenkor nem töröl elavultat', async () => {
    const d = deps('2026-04-14');
    const s = await runPlannedChecks(d, { articleUrls: [ARTICLE], budgetMs: -1 });
    expect(s.remaining).toBeGreaterThan(0);
    expect(d.calls.stale).toEqual([]);
  });
});
