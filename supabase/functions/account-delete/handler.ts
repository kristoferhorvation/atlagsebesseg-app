// AW22: fiók törlése (App Store-kötelező). A hívó saját JWT-jéből derül ki a felhasználó. A közösségi hőtérkép cellái névtelenek, nincs
// bennük azonosító: azok maradnak. Névtelen felhasználót nem töröl (annak nincs fiókja).
// AW25: 30 napos visszaállítás. A kérés a `account_deletions` táblába kerül (service_role), és a felhasználó minden munkamenete megszűnik;
// 30 napon belüli újra-bejelentkezés visszaállítja a fiókot (adatbázis-trigger), utána a napi `purge_retention` véglegesen törli: a sorok
// a külső kulcsokon esnek (profil, szinkron, felhős napló + hőtérkép, bejelentés, szavazat, dugó-minta). A visszaigazoló levelet a
// beszúrás triggere küldi (account-email).
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
  const req2 = await fetchFn(`${env.supabaseUrl}/rest/v1/account_deletions?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({ user_id: user.id }),
  });
  if (!req2.ok) return json({ error: 'a törlés nem sikerült' }, 500);
  // minden készülék kijelentkezik (a frissítő tokenek is): a 30 nap alatt csak új bejelentkezés hozza vissza a fiókot
  const out = await fetchFn(`${env.supabaseUrl}/auth/v1/logout?scope=global`, { method: 'POST', headers: { Authorization: auth, apikey: env.anonKey } });
  if (!out.ok && out.status !== 204) return json({ error: 'a törlés nem sikerült' }, 500);
  return json({ deleted: true, restoreDays: 30 });
}
