// AW25: fiók-levelek (üdvözlés, a törlési kérés visszaigazolása). Az adatbázis-trigger hívja pg_net-tel (`queue_account_email`), a
// hitelesítés a CRON_SECRET (a Vaultból, mint a promote-temp-gates-nél). A címzett és a nyelv az auth-felhasználóból jön (service_role),
// a sablon az app-logic szótárából (`emails.bundle.js`). RESEND_API_KEY nélkül nem küld, csak jelzi (a sor az account_emails-ben marad,
// resend_id nélkül) – a levél hiánya soha nem hiba a hívónak.
export interface Env {
  supabaseUrl: string;
  serviceKey: string;
  cronSecret: string;
  resendKey: string;
  from: string;
}

export type Kind = 'welcome' | 'account_deleted';
export type Render = (kind: Kind, lang: string | null | undefined) => { subject: string; html: string; lang: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleEmail(req: Request, env: Env, render: Render, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST kell' }, 405);
  if (!env.cronSecret || !env.serviceKey || req.headers.get('Authorization') !== `Bearer ${env.cronSecret}`) return json({ error: 'tiltott' }, 401);
  const body = (await req.json().catch(() => null)) as { kind?: string; user_id?: string; ref?: string } | null;
  const kind = body?.kind;
  const uid = body?.user_id ?? '';
  if ((kind !== 'welcome' && kind !== 'account_deleted') || !/^[0-9a-f-]{36}$/.test(uid)) return json({ error: 'hibás kérés' }, 400);
  const admin = { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey };
  const u = await fetchFn(`${env.supabaseUrl}/auth/v1/admin/users/${uid}`, { headers: admin });
  if (!u.ok) return json({ sent: false, reason: 'no_user' });
  const user = (await u.json()) as { email?: string; is_anonymous?: boolean; user_metadata?: { lang?: string } };
  if (!user.email || user.is_anonymous) return json({ sent: false, reason: 'no_email' });
  // a próbák (`db:account-live`, e2e) fiókjai: nem küldünk nem létező címre (a visszapattanás a feladó hírnevét rontja)
  if (/@example\.(com|org|net)$/i.test(user.email)) return json({ sent: false, reason: 'test_address' });
  if (!env.resendKey) return json({ sent: false, reason: 'no_key' });
  const mail = render(kind, user.user_metadata?.lang);
  const r = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.from, to: [user.email], reply_to: 'hello@tempomate.app', subject: mail.subject, html: mail.html }),
  });
  if (!r.ok) return json({ sent: false, reason: `resend_${r.status}` }, 502);
  const id = ((await r.json()) as { id?: string }).id ?? '';
  const ref = encodeURIComponent(body?.ref ?? '');
  await fetchFn(`${env.supabaseUrl}/rest/v1/account_emails?user_id=eq.${uid}&kind=eq.${kind}&ref=eq.${ref}`, {
    method: 'PATCH',
    headers: { ...admin, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ resend_id: id }),
  });
  return json({ sent: true, id, lang: mail.lang });
}
