// Ideiglenes kapupárokból közösségi szakaszok (lásd supabase/README.md).
// Hívás: POST, Authorization: Bearer <CRON_SECRET> – Supabase Cron 10 percenként (a titok a Vaultban).
// A kapu-JWT-t a platform nem ellenőrzi (verify_jwt = false a config.toml-ban), a hitelesítés a CRON_SECRET.
// A logika a packages/data csomagban van; deploy előtt: npm run build:edge
import { runPromotion } from './promote.bundle.js';

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (req.method !== 'POST') return new Response('POST kell', { status: 405 });
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  if (!cronSecret || !serviceKey || req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return new Response('csak a cron hívhatja', { status: 401 });
  }
  try {
    const outcomes = await runPromotion({
      supabaseUrl,
      serviceRoleKey: serviceKey,
      overpassEndpoint: Deno.env.get('OVERPASS_ENDPOINT') ?? undefined,
    });
    const created = outcomes.filter((o) => o.sectionId).length;
    return Response.json({ pairs: outcomes.length, created, outcomes });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
