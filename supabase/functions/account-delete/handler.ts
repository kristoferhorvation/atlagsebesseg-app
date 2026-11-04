// AW22: fiók törlése (App Store-kötelező). A hívó saját JWT-jéből derül ki a felhasználó; a törlést a service_role végzi, a hozzá tartozó
// sorok a külső kulcsokon törlődnek (profil, szinkron, felhős napló + hőtérkép, bejelentés, szavazat, dugó-minta). A közösségi
// hőtérkép cellái névtelenek, nincs bennük azonosító: azok maradnak. Névtelen felhasználót nem töröl (annak nincs fiókja).
export interface Env {
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export async function handleDelete(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST kell' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !env.serviceKey) return json({ error: 'nincs bejelentkezve' }, 401);
  const me = await fetchFn(`${env.supabaseUrl}/auth/v1/user`, { headers: { Authorization: auth, apikey: env.anonKey } });
  if (!me.ok) return json({ error: 'nincs bejelentkezve' }, 401);
  const user = (await me.json()) as { id?: string; is_anonymous?: boolean };
  if (!user.id) return json({ error: 'nincs bejelentkezve' }, 401);
  if (user.is_anonymous) return json({ error: 'névtelen felhasználónak nincs fiókja' }, 403);
  const del = await fetchFn(`${env.supabaseUrl}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey },
  });
  if (!del.ok) return json({ error: 'a törlés nem sikerült' }, 500);
  return json({ deleted: true });
}
