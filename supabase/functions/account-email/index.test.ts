// Deno-teszt: a fiók-levél csak CRON_SECRET-tel, valódi e-mail-címre, a felhasználó nyelvén; kulcs nélkül nem küld.
//   npm run test:edge
import { assertEquals } from 'jsr:@std/assert@1';
import { handleEmail } from './handler.ts';
import { accountEmail } from './emails.bundle.js';

const env = { supabaseUrl: 'https://teszt.supabase.co', serviceKey: 'service', cronSecret: 'cron', resendKey: 're_x', from: 'Tempomate <no-reply@tempomate.app>' };
const uid = '00000000-0000-0000-0000-0000000000a1';
const post = (body: unknown, token = 'cron') =>
  new Request('https://x/account-email', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

function fake(user: unknown, resendStatus = 200) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fn = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: (init?.body as string) ?? null });
    if (url.includes('/auth/v1/admin/users/')) return Promise.resolve(user ? new Response(JSON.stringify(user)) : new Response('', { status: 404 }));
    if (url.startsWith('https://api.resend.com')) return Promise.resolve(new Response(JSON.stringify({ id: 'mail1' }), { status: resendStatus }));
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  return { fn, calls };
}

Deno.test('fiók-levél: üdvözlés a felhasználó nyelvén, a Resend-azonosító visszaírva', async () => {
  const { fn, calls } = fake({ email: 'a@b.hu', is_anonymous: false, user_metadata: { lang: 'de' } });
  const r = await handleEmail(post({ kind: 'welcome', user_id: uid }), env, accountEmail, fn);
  assertEquals(await r.json(), { sent: true, id: 'mail1', lang: 'de' });
  const sent = JSON.parse(calls[1].body ?? '{}');
  assertEquals(sent.to, ['a@b.hu']);
  assertEquals(sent.subject, 'Willkommen bei Tempomate');
  assertEquals(calls[2].method, 'PATCH');
  assertEquals(calls[2].url, `https://teszt.supabase.co/rest/v1/account_emails?user_id=eq.${uid}&kind=eq.welcome&ref=eq.`);
});

Deno.test('fiók-levél: rossz titok 401, hibás kérés 400, nem hív semmit', async () => {
  const a = fake({ email: 'a@b.hu' });
  assertEquals((await handleEmail(post({ kind: 'welcome', user_id: uid }, 'rossz'), env, accountEmail, a.fn)).status, 401);
  assertEquals((await handleEmail(post({ kind: 'spam', user_id: uid }), env, accountEmail, a.fn)).status, 400);
  assertEquals((await handleEmail(post({ kind: 'welcome', user_id: 'x' }), env, accountEmail, a.fn)).status, 400);
  assertEquals(a.calls.length, 0);
});

Deno.test('fiók-levél: Resend-kulcs nélkül, névtelennek, cím nélkül és próba-címre nem küld', async () => {
  const a = fake({ email: 'a@b.hu', is_anonymous: false });
  assertEquals(await (await handleEmail(post({ kind: 'account_deleted', user_id: uid }), { ...env, resendKey: '' }, accountEmail, a.fn)).json(), { sent: false, reason: 'no_key' });
  const b = fake({ email: '', is_anonymous: true });
  assertEquals(await (await handleEmail(post({ kind: 'welcome', user_id: uid }), env, accountEmail, b.fn)).json(), { sent: false, reason: 'no_email' });
  const c = fake({ email: 'aw22-a-1@example.com', is_anonymous: false });
  assertEquals(await (await handleEmail(post({ kind: 'welcome', user_id: uid }), env, accountEmail, c.fn)).json(), { sent: false, reason: 'test_address' });
  assertEquals([...a.calls, ...b.calls, ...c.calls].some((c) => c.url.startsWith('https://api.resend.com')), false);
});
