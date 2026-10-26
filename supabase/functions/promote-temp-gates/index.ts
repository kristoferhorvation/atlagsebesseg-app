// Ideiglenes kapupárokból közösségi szakaszok (lásd supabase/README.md).
// Hívás: POST, Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> – pl. Supabase Cron 10 percenként.
// A logika a packages/data csomagban van; deploy előtt: npm run build:edge
import { runPromotion } from './promote.bundle.js';

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (req.method !== 'POST') return new Response('POST kell', { status: 405 });
  if (!serviceKey || req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return new Response('csak service_role hívhatja', { status: 401 });
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
