// Tervezett rendőrségi mérések a police.hu-ról (lásd supabase/README.md, „fetch-planned-checks”).
// Hívás: POST, Authorization: Bearer <CRON_SECRET> – Supabase Cron hétfőn és csütörtökön 06:00-kor
// (budapesti idő; a titok a Vaultban). A kapu-JWT-t a platform nem ellenőrzi (verify_jwt = false).
// A logika a packages/data csomagban van; deploy előtt: npm run build:edge
// Válasz: 200 + összegzés (megyénként a sorok és a nem elhelyezhető helyszínek), 500 + hiba, ha
// a police.hu nem érhető el vagy a hírlista szerkezete megváltozott (0 hír) – nincs csendes üres eredmény.
import { extractText, getDocumentProxy } from 'npm:unpdf@1.9.1';
import { runFetchPlannedChecks } from './planned.bundle.js';

/** Az edge function időkorlátja 150 s; ennyi után nem indít új Overpass-lekérést (a maradék a következő futásé). */
const BUDGET_MS = 100_000;

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (req.method !== 'POST') return new Response('POST kell', { status: 405 });
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  if (!cronSecret || !serviceKey || req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return new Response('csak a cron hívhatja', { status: 401 });
  }
  // kézi futtatás egy adott cikkre: {"articleUrls": ["https://www.police.hu/..."]}
  const body = (await req.json().catch(() => ({}))) as { articleUrls?: unknown };
  const articleUrls = Array.isArray(body.articleUrls)
    ? body.articleUrls.filter((u): u is string => typeof u === 'string' && u.startsWith('https://www.police.hu/'))
    : undefined;
  try {
    const summary = await runFetchPlannedChecks(
      {
        supabaseUrl,
        serviceRoleKey: serviceKey,
        overpassEndpoint: Deno.env.get('OVERPASS_ENDPOINT') ?? undefined,
        pdfText: async (bytes: Uint8Array) => (await extractText(await getDocumentProxy(bytes), { mergePages: true })).text,
      },
      { budgetMs: BUDGET_MS, articleUrls },
    );
    return Response.json(summary, { status: summary.errors.length ? 500 : 200 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
