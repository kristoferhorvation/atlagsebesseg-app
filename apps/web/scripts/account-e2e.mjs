// AW22: a webes fiók végigpróbálása böngészőben, az ÉLŐ Supabase-en: bejelentkező link → munkamenet → „Így szólítsunk?” → szinkron a szerverre → felhős mentés
// kapcsolója → kijelentkezés (a helyi adat marad) → újra be → fiók törlése. A linket az admin API állítja elő, levél nem megy ki; a teszt-felhasználó a végén törlődik.
//   SHOTS_BASE=http://localhost:5173 node apps/web/scripts/account-e2e.mjs   (fut a dev-szerver)
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { closeChrome, launchChrome, openPage, sleep } from './cdp.mjs';

const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const env = Object.fromEntries(readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let ok = 0;
let bad = 0;
const check = (cond, label, detail) => {
  cond ? ok++ : bad++;
  console.log(`${cond ? 'OK ' : 'HIBA'} ${label}${!cond && detail !== undefined ? ` – ${JSON.stringify(detail)}` : ''}`);
};
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const click = (p, sel) => p.evaluate(`${q(sel)}.click(); true`);
const email = `aw22-web-${Date.now()}@example.com`;
const { data: created, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true });
if (ce) throw ce;
const uid = created.user.id;

/** A levélben lévő link megnyitása: a redirect a munkamenetet az URL-ben hozza vissza. */
const openLink = async (page) => {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${BASE}/?sheet=settings&heat=ki` } });
  if (error) throw error;
  const r = await fetch(data.properties.action_link, { redirect: 'manual' });
  await page.goto(r.headers.get('location').replace(BASE, ''));
  await start(page);
};
/** A kezdőképernyő „Indítás” gombja (böngészőben a GPS-hez gesztus kell). */
const start = async (page) => {
  await page.waitFor(q('.start .btn.primary'), 30000, 'kezdőképernyő');
  await click(page, '.start .btn.primary');
};
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await sleep(300);
  }
};
const fieldOf = async (key) => (await admin.from('account_fields').select('value').eq('user_id', uid).eq('key', key).maybeSingle()).data?.value;

const chrome = await launchChrome({ photo: false });
try {
  const p = await openPage({ port: chrome.port, base: BASE, outDir: '/tmp', map: 'blank' });
  await p.goto('/?sheet=settings&heat=ki');
  await start(p);
  await p.waitFor(q('[data-testid="account-card"]'), 60000, 'Fiók kártya');
  check((await p.evaluate(`${q('[data-testid="account-card"]')}.dataset.state`)) === 'out', 'indulás: kijelentkezve (a bejelentkezés nem kötelező, nem kérdez)');
  check(await p.evaluate(`!!${q('[data-testid="account-not-configured"]')}`), 'az Apple/Google hiányát felirat jelzi', 'a szolgáltatók beállítása után ez a sor eltűnik');
  // a küldést itt nem nyomjuk meg: a beépített levelező korlátja (2 levél / óra) a valódi próbát vinné el
  await click(p, '[data-testid="account-email"]');
  await p.waitFor(q('.account-email-form input'), 5000, 'e-mail mező');
  check(await p.evaluate(`${q('[data-testid="account-email-send"]')}.disabled`), 'cím nélkül a küldés gomb tiltott');

  await openLink(p);
  await p.waitFor(`${q('[data-testid="account-card"]')}?.dataset.state === 'in'`, 30000, 'bejelentkezve');
  const card = await p.evaluate(`${q('[data-testid="account-card"]')}.innerText`);
  check(card.includes(email), 'a bejelentkező linkkel belépve a kártya az e-mailt mutatja', card);
  await p.waitFor(q('[data-testid="name-step"]'), 20000, '„Így szólítsunk?”');
  check((await p.evaluate(`${q('[data-testid="name-step"] input')}.value`)) === '', 'e-mailes első belépés után a névlépés üres mezővel');
  await p.evaluate(`(() => { const i = ${q('[data-testid="name-step"] input')}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Próba'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await click(p, '[data-testid="name-save"]');
  await p.waitFor(`!${q('[data-testid="name-step"]')}`, 5000, 'névlépés zárul');
  const prof = await until(async () => {
    const { data } = await admin.from('profiles').select('*').eq('user_id', uid).maybeSingle();
    return data?.megszolitas === 'Próba' && data?.name_prompted ? data : null;
  });
  check(!!prof, 'a Megszólítás a profiles táblába került, a lépés nem jön vissza', prof);

  await p.evaluate(`[...document.querySelectorAll('.segmented button')].find((b) => b.innerText === 'mph').click(); true`);
  check((await until(async () => (await fieldOf('settings.egyseg')) === 'mph')) === true, 'a beállítás 2,5 s-on belül a szerveren (`account_fields`)');
  await click(p, '[data-testid="account-card"] .switch');
  check((await until(async () => (await fieldOf('settings.felho_mentes')) === true)) === true, 'a felhős mentés kapcsolója átjut');
  const heat = await until(async () => (await admin.from('cloud_heat').select('device_id').eq('user_id', uid)).data?.length > 0);
  check(heat === true, 'bekapcsolva a saját hőtérkép sora felkerül');
  await until(() => p.evaluate(`${q('[data-testid="account-sync"]')}?.dataset.status === 'ok'`));
  check(/Szinkronizálva/.test(await p.evaluate(`${q('[data-testid="account-sync"]')}.innerText`)), 'a kártya a szinkron idejét mutatja');

  await click(p, '[data-testid="account-signout"]');
  await p.waitFor(`${q('[data-testid="account-card"]')}?.dataset.state === 'out'`, 15000, 'kijelentkezve');
  await until(() => p.evaluate(`JSON.parse(localStorage.getItem('settings:v1')).felho_mentes === false && Object.keys(localStorage).filter((k) => k.endsWith('-auth-token')).length === 1`));
  const local = await p.evaluate(`JSON.parse(localStorage.getItem('settings:v1'))`);
  check(local.egyseg === 'mph' && local.megszolitas === 'Próba', 'kijelentkezés után a helyi adatok maradnak', local);
  check(local.felho_mentes === false, 'a mentés kapcsolója nem kerül át a következő fiókra');
  const anonOk = await p.evaluate(`Object.keys(localStorage).filter((k) => k.endsWith('-auth-token')).map((k) => JSON.parse(localStorage.getItem(k)).user.is_anonymous)[0]`);
  check(anonOk === true, 'a készülék új névtelen felhasználóval folytat', anonOk);

  await openLink(p);
  await p.waitFor(`${q('[data-testid="account-card"]')}?.dataset.state === 'in'`, 30000, 'újra bejelentkezve');
  await sleep(500);
  check(await p.evaluate(`!${q('[data-testid="name-step"]')}`), 'második belépésnél nincs névlépés');
  await click(p, '[data-testid="account-delete"]');
  await p.waitFor(q('[data-testid="account-delete-confirm"]'), 5000, 'megerősítés');
  await click(p, '[data-testid="account-delete-confirm"]');
  await p.waitFor(`${q('[data-testid="account-card"]')}?.dataset.state === 'out'`, 20000, 'törölve');
  check((await admin.auth.admin.getUserById(uid)).error !== null, 'fiók törlése a Beállításokból: az auth-felhasználó eltűnt');
  check((await admin.from('profiles').select('user_id').eq('user_id', uid)).data?.length === 0 && (await admin.from('account_fields').select('key').eq('user_id', uid)).data?.length === 0 && (await admin.from('cloud_heat').select('device_id').eq('user_id', uid)).data?.length === 0, 'fiók törlése: a sorai eltűntek');
  check((await p.evaluate(`JSON.parse(localStorage.getItem('settings:v1')).egyseg`)) === 'mph', 'fiók törlése után a helyi adatok maradnak');
  await p.close();
} catch (e) {
  bad++;
  console.error('HIBA', e);
} finally {
  await closeChrome(chrome).catch(() => undefined);
  await admin.auth.admin.deleteUser(uid).catch(() => undefined);
}
console.log(`${ok}/${ok + bad} ellenőrzés zöld`);
process.exit(bad ? 1 : 0);
