import { describe, expect, it, vi } from 'vitest';
import { timeAgo } from '../src/display';
import { FOLLOW_INITIAL, followReducer, type FollowEvent, type FollowState } from '../src/follow';
import { ownReport, ReportFeed, reportQuery, reportVisual, rowToActiveReport, type ActiveReport } from '../src/reportFeed';
import type { ReportRow } from '../src/supabase';

const rep = (id: string, expiresAt = 10_000_000, extra: Partial<ActiveReport> = {}): ActiveReport => ({
  id,
  type: 'rendorseg',
  gateKind: null,
  lat: 46.2,
  lon: 11.7,
  headingDeg: 90,
  createdAt: 0,
  expiresAt,
  confirmations: 0,
  denials: 0,
  own: false,
  ...extra,
});

describe('reportQuery (bbox, csempékben)', () => {
  it('a látható terület kifelé a csempe-rácsra kerekítve', () => {
    const q = reportQuery({ south: 46.21, west: 11.61, north: 46.26, east: 11.68 }, null)!;
    expect(q.bbox).toEqual({ south: 46, west: 11.5, north: 46.5, east: 12 });
    expect(q.key).toBe('92:23:92:23');
  });
  it('kis mozdulat ugyanazt a kulcsot adja (nincs új lekérés)', () => {
    const a = reportQuery({ south: 46.21, west: 11.61, north: 46.26, east: 11.68 }, null)!;
    const b = reportQuery({ south: 46.22, west: 11.62, north: 46.27, east: 11.69 }, null)!;
    expect(b.key).toBe(a.key);
  });
  it('csempehatáron átnyúló nézet: két csempe', () => {
    const q = reportQuery({ south: 46.45, west: 11.9, north: 46.55, east: 12.1 }, null)!;
    expect(q.bbox).toEqual({ south: 46, west: 11.5, north: 47, east: 12.5 });
  });
  it('kizoomolva legfeljebb 3 × 3 csempe a nézet közepén', () => {
    const q = reportQuery({ south: 40, west: 5, north: 50, east: 20 }, null)!;
    expect(q.bbox.north - q.bbox.south).toBe(1.5);
    expect(q.bbox.east - q.bbox.west).toBe(1.5);
  });
  it('térkép nélkül a pont körüli 3 × 3 csempe (mint a szakaszoknál); semmi nélkül null', () => {
    expect(reportQuery(null, { lat: 46.2, lon: 11.7 })!.bbox).toEqual({ south: 45.5, west: 11, north: 47, east: 12.5 });
    expect(reportQuery(null, null)).toBeNull();
  });
});

describe('ReportFeed', () => {
  const q1 = reportQuery(null, { lat: 46.2, lon: 11.7 })!;
  const q2 = reportQuery(null, { lat: 48.2, lon: 16.3 })!;

  it('lekérés: első alkalommal, új téglalapnál és 60 s után – közte nem', async () => {
    let now = 1_000_000;
    const fetch = vi.fn(async () => [rep('a')]);
    const feed = new ReportFeed(fetch, { now: () => now });
    expect(await feed.refresh(q1)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(q1.bbox);
    expect(await feed.refresh(q1)).toBe(false);
    now += 59_000;
    expect(feed.shouldFetch(q1)).toBe(false);
    expect(feed.shouldFetch(q2)).toBe(true);
    now += 1_000;
    expect(await feed.refresh(q1)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(feed.list().map((r) => r.id)).toEqual(['a']);
  });

  it('a saját bejelentés azonnal látszik, a szerver-lista megérkezésekor nem duplázódik', async () => {
    const now = 1_000_000;
    let server: ActiveReport[] = [];
    const feed = new ReportFeed(async () => server, { now: () => now });
    await feed.refresh(q1);
    feed.addOwn(ownReport({ type: 'traffipax', lat: 46.2, lon: 11.7, heading_deg: 10 }, 'x', now));
    expect(feed.list().map((r) => [r.id, r.own])).toEqual([['x', true]]);
    server = [rep('x', now + 7_200_000, { own: true }), rep('y')];
    await feed.refresh(q2);
    expect(feed.list().map((r) => r.id).sort()).toEqual(['x', 'y']);
  });

  it('a saját bejelentés megmarad, ha a szerver-válasz még nem tartalmazza', async () => {
    const now = 1_000_000;
    const feed = new ReportFeed(async () => [rep('y')], { now: () => now });
    feed.addOwn(ownReport({ type: 'baleset', lat: 1, lon: 2, heading_deg: null }, 'x', now));
    await feed.refresh(q1);
    expect(feed.list().map((r) => r.id).sort()).toEqual(['x', 'y']);
  });

  it('a lejártak a lekérések között is eltűnnek', async () => {
    let now = 1_000_000;
    const feed = new ReportFeed(async () => [rep('a', now + 30_000), rep('b', now + 90_000)], { now: () => now });
    await feed.refresh(q1);
    expect(feed.list()).toHaveLength(2);
    now += 30_000;
    expect(feed.list().map((r) => r.id)).toEqual(['b']);
  });

  it('hálózati hiba: a régi lista marad, újrapróbálás csak a frissítési idő után', async () => {
    let now = 1_000_000;
    let fail = false;
    const fetch = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return [rep('a')];
    });
    const feed = new ReportFeed(fetch, { now: () => now });
    await feed.refresh(q1);
    fail = true;
    now += 60_000;
    expect(await feed.refresh(q1)).toBe(false);
    expect(feed.list().map((r) => r.id)).toEqual(['a']);
    expect(feed.shouldFetch(q1)).toBe(false);
    now += 60_000;
    expect(feed.shouldFetch(q1)).toBe(true);
  });

  it('késve érkező, elavult válasz eldobva', async () => {
    const resolvers: ((r: ActiveReport[]) => void)[] = [];
    const feed = new ReportFeed(() => new Promise((res) => resolvers.push(res)), { now: () => 1_000_000 });
    const slow = feed.refresh(q1);
    expect(feed.shouldFetch(q1)).toBe(false);
    const fast = feed.refresh(q2);
    resolvers[1]!([rep('uj')]);
    expect(await fast).toBe(true);
    resolvers[0]!([rep('regi')]);
    expect(await slow).toBe(false);
    expect(feed.list().map((r) => r.id)).toEqual(['uj']);
  });

  it('saját szavazat megjegyezve', () => {
    const feed = new ReportFeed(async () => []);
    expect(feed.myVote('a')).toBeNull();
    feed.vote('a', false);
    expect(feed.myVote('a')).toBe(false);
  });
});

describe('bejelentés-sor és megjelenés', () => {
  const row: ReportRow = {
    id: 'r1',
    type: 'ideiglenes_kapu',
    lat: 46,
    lon: 11,
    heading_deg: 180,
    gate_kind: 'zaro',
    confirmations: 2,
    denials: 1,
    created_at: '2026-10-27T10:00:00Z',
    expires_at: '2026-10-27T12:00:00Z',
    user_id: 'u1',
  };
  it('sorból: idők ms-ben, saját-e', () => {
    const r = rowToActiveReport(row, 'u1');
    expect(r.createdAt).toBe(Date.parse('2026-10-27T10:00:00Z'));
    expect(r.own).toBe(true);
    expect(rowToActiveReport(row, 'u2').own).toBe(false);
    expect(rowToActiveReport(row, null).own).toBe(false);
  });
  it('ikon és tónus a bejelentés-lappal egyezően, kapuknál kezdő/záró', () => {
    expect(reportVisual(rowToActiveReport(row, null))).toEqual({ icon: 'kapu_zaro', tone: 'kezi', label: 'Átlagmérés vége' });
    expect(reportVisual({ type: 'ideiglenes_kapu', gateKind: 'kezdo' }).icon).toBe('kapu_kezdo');
    expect(reportVisual({ type: 'traffipax', gateKind: null })).toEqual({ icon: 'traffipax', tone: 'hataron', label: 'Traffipax' });
  });
  it('mikor jelentették', () => {
    expect(timeAgo(20_000)).toBe('most');
    expect(timeAgo(12 * 60_000 + 5_000)).toBe('12 perce');
    expect(timeAgo(125 * 60_000)).toBe('2 órája');
    expect(timeAgo(-5)).toBe('most');
  });
});

describe('followReducer (követés ki/be)', () => {
  const run = (events: FollowEvent[], s: FollowState = FOLLOW_INITIAL) => events.reduce((acc, e) => followReducer(acc, e), s);

  it('mozdulat kikapcsolja, a gomb visszakapcsolja', () => {
    const off = run([{ type: 'gesture', at: 1000 }]);
    expect(off.following).toBe(false);
    expect(run([{ type: 'recenter' }], off).following).toBe(true);
  });
  it('mérés közben 5 s tétlenség után magától visszaáll', () => {
    const off = run([{ type: 'gesture', at: 1000 }]);
    expect(run([{ type: 'tick', at: 5999, measuring: true }], off).following).toBe(false);
    expect(run([{ type: 'tick', at: 6000, measuring: true }], off).following).toBe(true);
  });
  it('a folytatódó mozdulat újraindítja a tétlenség-órát', () => {
    const s = run([
      { type: 'gesture', at: 1000 },
      { type: 'gesture', at: 4000 },
      { type: 'tick', at: 6500, measuring: true },
    ]);
    expect(s.following).toBe(false);
    expect(run([{ type: 'tick', at: 9000, measuring: true }], s).following).toBe(true);
  });
  it('mérésen kívül csak a gombra áll vissza', () => {
    const s = run([
      { type: 'gesture', at: 1000 },
      { type: 'tick', at: 60_000, measuring: false },
    ]);
    expect(s.following).toBe(false);
  });
  it('követés közben a tick és a gomb nem változtat (ugyanaz az objektum – nincs újrarenderelés)', () => {
    expect(followReducer(FOLLOW_INITIAL, { type: 'tick', at: 99_999, measuring: true })).toBe(FOLLOW_INITIAL);
    expect(followReducer(FOLLOW_INITIAL, { type: 'recenter' })).toBe(FOLLOW_INITIAL);
  });
});
