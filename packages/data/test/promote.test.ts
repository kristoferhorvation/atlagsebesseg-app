import { describe, expect, it, vi } from 'vitest';
import { promoteTempGates, type CreateSectionArgs, type GateReport, type PromoteDeps } from '../src/promote';
import { SupabaseRest } from '../src/supabaseRest';
import { at, north, P, primary, south } from './helpers/synthetic';

// SZINTETIKUS úthálózat: osztott pályás autópálya (észak felé x = +15, dél felé x = −15).
const gate = (id: string, kind: 'kezdo' | 'zaro', x: number, y: number, heading: number, over: Partial<GateReport> = {}): GateReport => ({
  id,
  gate_kind: kind,
  heading_deg: heading,
  road: null,
  speed_limit_kmh: null,
  ...at(x, y),
  ...over,
});

function fakeDeps(reports: GateReport[], pairs: [string, string][]) {
  const created: CreateSectionArgs[] = [];
  const failed: [string, string, string][] = [];
  const deps: PromoteDeps = {
    readyPairs: async () => pairs.map(([s, e]) => ({ start_report_id: s, end_report_id: e, distance_m: 0, independent_confirms: 3 })),
    reports: async (ids) => reports.filter((r) => ids.includes(r.id)),
    roadsIn: async () => [north.way, south.way, primary.way],
    countryAt: async () => 'IT',
    createSection: async (args) => {
      created.push(args);
      return `kozosseg-tg-${args.p_start}`;
    },
    markFailed: async (s, e, err) => {
      failed.push([s, e, err]);
    },
  };
  return { deps, created, failed };
}

describe('promoteTempGates', () => {
  it('a kapuk közti útvonal a helyes pályatesten fut; határ és útszám az úthálózatból', async () => {
    // a kapuk kicsit a két pályatest között vannak – az irány dönt
    const { deps, created, failed } = fakeDeps(
      [gate('s1', 'kezdo', 2, 1000, 0), gate('e1', 'zaro', 2, 9000, 0)],
      [['s1', 'e1']],
    );
    const out = await promoteTempGates(deps);
    expect(failed).toEqual([]);
    expect(out).toEqual([expect.objectContaining({ sectionId: 'kozosseg-tg-s1' })]);
    const c = created[0]!;
    expect(c).toMatchObject({ p_start: 's1', p_end: 'e1', p_road: 'A22', p_speed_limit_kmh: 130, p_country: 'IT' });
    expect(Math.abs(c.p_length_m - 8000)).toBeLessThan(30);
    // GeoJSON-sorrend [lon, lat]; a belső pontok az észak felé tartó pályán (x ≈ +15)
    for (const [lon, lat] of c.p_geometry.slice(1, -1)) expect(Math.abs(P.toXY({ lat, lon }).x - 15)).toBeLessThan(2);
  });

  it('ellenirányú kapupár a déli pályát kapja', async () => {
    const { deps, created } = fakeDeps([gate('s2', 'kezdo', -2, 9000, 180), gate('e2', 'zaro', -2, 1000, 180)], [['s2', 'e2']]);
    await promoteTempGates(deps);
    for (const [lon, lat] of created[0]!.p_geometry.slice(1, -1)) expect(Math.abs(P.toXY({ lat, lon }).x + 15)).toBeLessThan(2);
  });

  it('ha nincs út a kapuk közelében, naplózza a hibát és nem hoz létre szakaszt', async () => {
    const { deps, created, failed } = fakeDeps([gate('s3', 'kezdo', 5000, 0, 0), gate('e3', 'zaro', 5000, 8000, 0)], [['s3', 'e3']]);
    const out = await promoteTempGates(deps);
    expect(created).toEqual([]);
    expect(out[0]!.error).toMatch(/nincs autópálya/);
    expect(failed[0]!.slice(0, 2)).toEqual(['s3', 'e3']);
  });

  it('a létrehozás hibája (pl. az SQL szerint már nem kész) sem állítja meg a többit', async () => {
    const { deps, created } = fakeDeps(
      [gate('s4', 'kezdo', 2, 1000, 0), gate('e4', 'zaro', 2, 4000, 0), gate('s5', 'kezdo', 2, 5000, 0), gate('e5', 'zaro', 2, 9000, 0)],
      [['s4', 'e4'], ['s5', 'e5']],
    );
    const orig = deps.createSection;
    deps.createSection = async (a) => (a.p_start === 's4' ? Promise.reject(new Error('a kapupár nem kész')) : orig(a));
    const out = await promoteTempGates(deps);
    expect(out.map((o) => o.error ?? o.sectionId)).toEqual(['a kapupár nem kész', 'kozosseg-tg-s5']);
    expect(created).toHaveLength(1);
  });
});

describe('SupabaseRest', () => {
  it('rpc: POST a /rest/v1/rpc/<fn> végpontra, kulccsal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('"ok"', { status: 200 }));
    const db = new SupabaseRest({ url: 'https://x.supabase.co', key: 'KEY', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await db.rpc('f', { a: 1 })).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://x.supabase.co/rest/v1/rpc/f');
    expect(init.headers).toMatchObject({ apikey: 'KEY', Authorization: 'Bearer KEY' });
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it('upsert: on_conflict és merge-duplicates', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 201 }));
    const db = new SupabaseRest({ url: 'https://x.supabase.co', key: 'K', fetchImpl: fetchImpl as unknown as typeof fetch });
    await db.upsert('sections', [{ id: 'a' }], 'id');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://x.supabase.co/rest/v1/sections?on_conflict=id');
    expect(init.headers.Prefer).toContain('resolution=merge-duplicates');
  });

  it('HTTP-hibánál kivételt dob a válasszal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('permission denied', { status: 401 }));
    const db = new SupabaseRest({ url: 'https://x', key: 'K', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(db.select('reports', 'select=*')).rejects.toThrow(/401.*permission denied/);
  });
});
