import { describe, expect, it } from 'vitest';
import { heatZones, uploadHeatRows, uploadRows, HEAT, type HeatGeo, type HeatPass, type SupabaseClient } from '../src';

// AW20-javítás: a zónák és a mentett helyek csak helyben élnek – a hálózatra csak a `heat_cells` oszlopai mennek
describe('közösségi feltöltés – helyi adatok', () => {
  const geo: HeatGeo = {
    center: (h3) => ({ lat: 47 + Number(h3.slice(1)) * 0.001, lon: 19 }),
    parent: (h3) => `p${h3}`,
  };
  const pass = (h3: string): HeatPass => ({ h3, avgKmh: 60, t: 1_800_000_000_000, fromStartM: 5000, toEndM: 5000 });

  it('a feltöltés kérése csak a heat_cells tábla nyolc oszlopát tartalmazza, a zónák és a mentett helyek nélkül', async () => {
    const saved = { home: { id: 'home', name: 'Titkos otthon', address: 'Titok utca 1', lat: 47.01, lon: 19 }, work: null, others: [] };
    const zones = heatZones(saved, { home: 200 });
    const rows = uploadRows([pass('c10'), pass('c500')], geo, 60, HEAT.shareEndsM, zones);
    const sent: { table: string; payload: unknown }[] = [];
    const client = { from: (table: string) => ({ insert: (payload: unknown) => (sent.push({ table, payload }), Promise.resolve({ error: null })) }) } as unknown as SupabaseClient;
    await uploadHeatRows(client, rows);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.table).toBe('heat_cells');
    const json = JSON.stringify(sent[0]!.payload);
    expect(json).not.toMatch(/Titkos|Titok|home|radius|zone|zona/i);
    for (const r of sent[0]!.payload as object[]) expect(Object.keys(r).sort()).toEqual(['avg_speed', 'count', 'dow', 'h3', 'h3_r8', 'hour', 'lat', 'lon']);
    expect((sent[0]!.payload as { h3: string }[]).map((r) => r.h3)).toEqual(['c500']);
  });
});
