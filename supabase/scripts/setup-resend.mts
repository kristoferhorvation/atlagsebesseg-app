// AW23: a Resend-levelezés beállítása. A kulcs a gitignore-olt `.env.resend`-ben (RESEND_API_KEY, RESEND_DOMAIN), a Supabase-hozzáférés a
// `supabase login` tokenje. Lépések: `domain` (felvétel + DNS-rekordok listája), `verify` (igazolás), `smtp` (Supabase Auth SMTP, korlát),
// `templates` (levélsablonok 6 nyelven), `auth-urls` (AW24: az app.tempomate.app az átirányítások közé; a Site URL csak élő DNS-nél vált). Értéket (kulcsot) nem ír ki.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { authEmailConfig, BRAND_NAME } from '../../packages/app-logic/src/authEmails';

const PROJECT = 'vewendmvvybrlymncdji';
const APP_ORIGIN = 'https://app.tempomate.app';
const OLD_ORIGIN = 'https://atlagsebesseg.vercel.app';
const env = (): { key: string; domain: string } => {
  const raw = readFileSync(new URL('../../.env.resend', import.meta.url), 'utf8');
  const get = (k: string) => raw.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim() ?? '';
  const key = get('RESEND_API_KEY');
  const domain = get('RESEND_DOMAIN');
  if (!key || !domain) throw new Error('.env.resend: RESEND_API_KEY és RESEND_DOMAIN kell');
  return { key, domain };
};
const resend = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`https://api.resend.com${path}`, { ...init, headers: { Authorization: `Bearer ${env().key}`, 'Content-Type': 'application/json' } });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Resend ${path}: HTTP ${r.status} ${JSON.stringify(body)}`);
  return body;
};
const supabaseToken = () => {
  const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim();
  return raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice(18), 'base64').toString('utf8') : raw;
};
const patchAuth = async (body: object) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/config/auth`, { method: 'PATCH', headers: { Authorization: `Bearer ${supabaseToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Supabase: HTTP ${r.status} ${await r.text()}`);
};
const domainOf = async () => {
  const list = (await resend('/domains')) as { data: { id: string; name: string; status: string }[] };
  return list.data.find((d) => d.name === env().domain) ?? null;
};
const printRecords = (d: { name?: string; status?: string; records?: { record: string; name: string; type: string; value: string; priority?: number; status: string }[] }) => {
  console.log(`${d.name}: ${d.status}`);
  for (const r of d.records ?? []) console.log(`${r.type}\t${r.name}\t${r.priority ?? ''}\t${r.value}\t[${r.status}]`);
  console.log(`TXT\t_dmarc\t\tv=DMARC1; p=none;\t[ajánlott]`);
};

switch (process.argv[2]) {
  case 'domain': {
    const found = await domainOf();
    const d = found ? await resend(`/domains/${found.id}`) : await resend('/domains', { method: 'POST', body: JSON.stringify({ name: env().domain, region: 'eu-west-1' }) });
    printRecords(d as never);
    break;
  }
  case 'verify': {
    const found = await domainOf();
    if (!found) throw new Error('előbb: domain');
    await resend(`/domains/${found.id}/verify`, { method: 'POST' });
    printRecords((await resend(`/domains/${found.id}`)) as never);
    break;
  }
  case 'smtp': {
    const { key, domain } = env();
    await patchAuth({ smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend', smtp_pass: key, smtp_admin_email: `no-reply@${domain}`, smtp_sender_name: BRAND_NAME, rate_limit_email_sent: 100 });
    console.log('Supabase SMTP: Resend, feladó no-reply@%s, korlát 100 levél / óra', domain);
    break;
  }
  case 'templates':
    await patchAuth(authEmailConfig());
    console.log('Levélsablonok feltöltve (6 nyelv).');
    break;
  case 'auth-urls': {
    // additív: a régi cím marad az engedélyezettek között, amíg az átirányítás nem él (a régi levelek linkjei is ide mutatnak)
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/config/auth`, { headers: { Authorization: `Bearer ${supabaseToken()}` } });
    if (!r.ok) throw new Error(`Supabase: HTTP ${r.status}`);
    const cur = (await r.json()) as { uri_allow_list?: string; site_url?: string };
    const list = new Set((cur.uri_allow_list ?? '').split(',').map((x) => x.trim()).filter(Boolean));
    list.add(`${APP_ORIGIN}/**`);
    const live = await fetch(`${APP_ORIGIN}/manifest.webmanifest`).then((x) => x.ok, () => false);
    await patchAuth({ uri_allow_list: [...list].join(','), ...(live ? { site_url: APP_ORIGIN } : {}) });
    console.log('Átirányítások: %d cím, Site URL: %s', list.size, live ? APP_ORIGIN : `${cur.site_url ?? OLD_ORIGIN} (a DNS még nem él, nem vált)`);
    break;
  }
  default:
    throw new Error('használat: setup-resend.mts domain|verify|smtp|templates|auth-urls');
}
