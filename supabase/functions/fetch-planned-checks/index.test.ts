// Deno-teszt: a bundle betölthető, és a futás hamis police.hu / Supabase mellett végigmegy.
//   npm run test:edge
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { runFetchPlannedChecks } from './planned.bundle.js';

const LISTING = `<article><header><h1><a href="/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet/x" hreflang="hu">Közlekedésrendészeti hírek</a></h1></header>
<footer><time datetime="2026-10-27 15:54">x</time><span class="location">Fejér Megyei Rendőr-főkapitányság</span></footer>
<div class="lead-text"><p>Fokozott ellenőrzés a hétvégén.</p></div></article>`;

function fakeFetch(listing: string, calls: { url: string; method: string; body?: string }[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : undefined });
    if (url.startsWith('https://www.police.hu/')) return new Response(listing, { status: 200 });
    if (url.includes('/rest/v1/planned_checks?valid_to=lt.')) return Response.json([]);
    if (url.endsWith('/rest/v1/planned_check_runs')) return new Response(null, { status: 201 });
    return new Response('váratlan: ' + url, { status: 500 });
  }) as typeof fetch;
}

const env = { supabaseUrl: 'https://teszt.supabase.co', serviceRoleKey: 'x', pdfText: () => Promise.resolve('') };

Deno.test('fetch-planned-checks: nincs jelölt hír → 0 sor, a lejártak törlése és a napló lefut', async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch(LISTING, calls);
  try {
    const s = await runFetchPlannedChecks(env);
    assertEquals([s.listingItems, s.candidates, s.rows], [1, 0, 0]);
    assertEquals(calls.some((c) => c.method === 'DELETE' && c.url.includes('/planned_checks?valid_to=lt.')), true);
    const log = calls.find((c) => c.url.endsWith('/planned_check_runs'));
    assertEquals(JSON.parse(log!.body!)[0].ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test('fetch-planned-checks: megváltozott oldalszerkezet → hiba, és a naplóba ok=false kerül', async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch('<html><body>új dizájn</body></html>', calls);
  try {
    await assertRejects(() => runFetchPlannedChecks(env), Error, '0 hírt');
    const log = calls.find((c) => c.url.endsWith('/planned_check_runs'));
    assertEquals(JSON.parse(log!.body!)[0].ok, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
