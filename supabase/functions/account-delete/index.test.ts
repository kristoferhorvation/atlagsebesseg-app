// Deno-teszt: a fiók-törlés csak a saját JWT-vel, csak valódi fiókra, és a service_role-lal a saját azonosítóra hív.
//   npm run test:edge
import { assertEquals } from 'jsr:@std/assert@1';
import { handleDelete } from './handler.ts';

const env = { supabaseUrl: 'https://teszt.supabase.co', serviceKey: 'service', anonKey: 'anon' };
const post = (token?: string) => new Request('https://x/account-delete', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });

function fake(user: unknown, delStatus = 200) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const fn = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('Authorization') });
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(user ? new Response(JSON.stringify(user)) : new Response('', { status: 401 }));
    return Promise.resolve(new Response('', { status: delStatus }));
  }) as typeof fetch;
  return { fn, calls };
}

Deno.test('fiók törlése: a saját JWT azonosítójára, service_role-lal töröl', async () => {
  const { fn, calls } = fake({ id: 'u1', is_anonymous: false });
  const r = await handleDelete(post('sajat'), env, fn);
  assertEquals(r.status, 200);
  assertEquals(calls[0], { url: 'https://teszt.supabase.co/auth/v1/user', method: 'GET', auth: 'Bearer sajat' });
  assertEquals(calls[1], { url: 'https://teszt.supabase.co/auth/v1/admin/users/u1', method: 'DELETE', auth: 'Bearer service' });
});

Deno.test('fiók törlése: JWT nélkül és érvénytelen JWT-vel 401, nem töröl', async () => {
  const a = fake(null);
  assertEquals((await handleDelete(post(), env, a.fn)).status, 401);
  assertEquals(a.calls.length, 0);
  const b = fake(null);
  assertEquals((await handleDelete(post('rossz'), env, b.fn)).status, 401);
  assertEquals(b.calls.length, 1);
});

Deno.test('fiók törlése: névtelen felhasználót nem töröl', async () => {
  const { fn, calls } = fake({ id: 'a1', is_anonymous: true });
  assertEquals((await handleDelete(post('anon'), env, fn)).status, 403);
  assertEquals(calls.length, 1);
});

Deno.test('fiók törlése: GET tiltott, sikertelen törlés hibát ad', async () => {
  const req = new Request('https://x/account-delete', { method: 'GET' });
  assertEquals((await handleDelete(req, env, fake(null).fn)).status, 405);
  const { fn } = fake({ id: 'u1', is_anonymous: false }, 500);
  assertEquals((await handleDelete(post('sajat'), env, fn)).status, 500);
});
