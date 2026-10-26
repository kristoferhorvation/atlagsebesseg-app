// Deno-teszt: a bundle betölthető, és a handler hamis Supabase/Overpass-szal végigfut.
//   npm run test:edge
import { assertEquals } from 'jsr:@std/assert@1';
import { runPromotion } from './promote.bundle.js';

Deno.test('runPromotion: üres kész-pár lista mellett nem hív Overpass-t, nem hoz létre semmit', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rest/v1/rpc/temp_gate_ready_pairs')) return Promise.resolve(new Response('[]', { status: 200 }));
    return Promise.resolve(new Response('váratlan hívás', { status: 500 }));
  }) as typeof fetch;
  try {
    const out = await runPromotion({ supabaseUrl: 'https://teszt.supabase.co', serviceRoleKey: 'x' });
    assertEquals(out, []);
    assertEquals(calls, ['https://teszt.supabase.co/rest/v1/rpc/temp_gate_ready_pairs']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test('runPromotion: kész párra Overpass-ból útvonalat számol, és létrehozza a szakaszt', async () => {
  // SZINTETIKUS, egyenes autópálya észak felé 46.00 → 46.10 (≈ 11 km)
  const ids = Array.from({ length: 11 }, (_, i) => 100 + i);
  const geometry = ids.map((_, i) => ({ lat: 46 + i * 0.01, lon: 11 }));
  const way = { type: 'way', id: 1, nodes: ids, geometry, tags: { highway: 'motorway', ref: 'A22', maxspeed: '130' } };
  const bodies: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/rpc/temp_gate_ready_pairs')) {
      return Response.json([{ start_report_id: 's', end_report_id: 'e', distance_m: 8900, independent_confirms: 3 }]);
    }
    if (url.includes('/rest/v1/reports?')) {
      return Response.json([
        { id: 's', lat: 46.005, lon: 11.0002, heading_deg: 0, gate_kind: 'kezdo', road: null, speed_limit_kmh: null },
        { id: 'e', lat: 46.085, lon: 11.0002, heading_deg: 0, gate_kind: 'zaro', road: null, speed_limit_kmh: null },
      ]);
    }
    if (url.includes('overpass')) {
      const q = decodeURIComponent(String(init?.body ?? ''));
      return Response.json({ elements: q.includes('is_in') ? [{ type: 'area', id: 1, tags: { 'ISO3166-1': 'IT' } }] : [way] });
    }
    if (url.endsWith('/rpc/temp_gate_create_section')) {
      bodies.create = JSON.parse(String(init?.body));
      return Response.json('kozosseg-tg-s');
    }
    return new Response('váratlan: ' + url, { status: 500 });
  }) as typeof fetch;
  try {
    const out = await runPromotion({ supabaseUrl: 'https://teszt.supabase.co', serviceRoleKey: 'x' });
    assertEquals(out.map((o) => o.sectionId ?? o.error), ['kozosseg-tg-s']);
    const c = bodies.create as { p_road: string; p_speed_limit_kmh: number; p_country: string; p_length_m: number };
    assertEquals([c.p_road, c.p_speed_limit_kmh, c.p_country], ['A22', 130, 'IT']);
    assertEquals(Math.abs(c.p_length_m - 8896) < 30, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
