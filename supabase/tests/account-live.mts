// AW22: a fiók végigpróbálása az ÉLŐ Supabase-en, valódi GoTrue + RLS + edge function: névtelen → fiók adatmegőrzéssel, két készülék összefésülése,
// RLS valódi munkamenettel, fiók törlése. Levelet NEM küld (a linket az admin API állítja elő), a teszt-felhasználók a végén törlődnek.
//   npm run db:account-live
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  accountFieldsOf,
  claimMerge,
  DEFAULT_SETTINGS,
  deleteAccount,
  fetchAuthProviders,
  NO_CLOUD_STATE,
  NO_FIELDS,
  NO_SAVED,
  noteLocalFields,
  startEmailSignIn,
  supabaseRemote,
  syncBackupOnce,
  syncFieldsOnce,
  applyFields,
  type AccountData,
  type BackupStore,
  type HeatCell,
  type Trip,
  type TripSample,
} from '../../packages/app-logic/src/index.ts';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.SUPABASE_URL!;
const ANON = env.SUPABASE_ANON_KEY!;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const device = (): SupabaseClient => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' } });

let ok = 0;
let bad = 0;
const check = (cond: boolean, label: string, detail?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? 'OK ' : 'HIBA'} ${label}${!cond && detail !== undefined ? ` – ${JSON.stringify(detail)}` : ''}`);
};

const stamp = Date.now();
const created = new Set<string>();
const emailOf = (tag: string) => `aw22-${tag}-${stamp}@example.com`;
const must = <T,>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};

/** A bejelentkező link megnyitása: az admin API állítja elő (levél nélkül), a kapott átirányításból lesz munkamenet. */
async function openMagicLink(client: SupabaseClient, email: string): Promise<void> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const r = await fetch(data.properties.action_link, { redirect: 'manual' });
  const hash = new URL(r.headers.get('location')!.replace('#', '?')).searchParams;
  must(await client.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! }));
}

const anonDevice = async () => {
  const c = device();
  const { user } = must(await c.auth.signInAnonymously());
  created.add(user!.id);
  return { c, id: user!.id };
};

const report = async (c: SupabaseClient, lat: number) => (must(await c.from('reports').insert({ type: 'dugo', lat, lon: 19, heading_deg: 90 }).select('id')) as { id: string }[])[0]!.id;
const jam = async (c: SupabaseClient) => must(await c.from('jam_samples').insert({ kind: 'erzekelt', lat: 47.5, lon: 19, heading_deg: 90, avg_kmh: 10, length_m: 300 }));
const rowsOf = async (table: string, col: string, id: string) => (must(await admin.from(table).select('*').eq(col, id)) as unknown[]).length;

function memStore(trips: Trip[], cells: HeatCell[]) {
  const map = new Map(trips.map((t) => [t.id, t]));
  const samples = new Map<string, TripSample[]>();
  const st = { remote: [] as (readonly HeatCell[])[] };
  const store: BackupStore = {
    listTrips: async () => [...map.values()],
    samples: async (id) => samples.get(id) ?? [{ tripId: id, t: 1000, lat: 47, lon: 19, speedKmh: 50, heading: 90, accuracy: 5, h3: 'x', limitKmh: null }],
    saveDownloaded: async (t, s) => {
      map.set(t.id, t);
      samples.set(t.id, [...s]);
    },
    deleteTrip: async (id) => void map.delete(id),
    heatCells: async () => cells,
    setRemoteHeat: async (l) => void (st.remote = [...l]),
    listTracks: async () => [],
    saveTrack: async () => undefined,
  };
  return { store, map, st };
}
const trip = (id: string) => ({ id, startedAt: 1000, endedAt: 2000, distanceM: 500, movingS: 60, stoppedS: 0, path: [], measurements: [], turns: { left: 0, right: 0, uTurn: 0 }, dirChanges: { left: 0, right: 0, uTurn: 0 } }) as unknown as Trip;
const data = (patch: Partial<AccountData> = {}): AccountData => ({ settings: DEFAULT_SETTINGS, lang: 'auto', saved: NO_SAVED, recents: [], ...patch });

try {
  const providers = await fetchAuthProviders(URL_, ANON);
  check(providers?.email === true, 'auth-beállítás: az e-mailes belépés elérhető', providers);

  // 1. névtelen → fiók: ugyanaz a felhasználó, minden sora megmarad
  const a = await anonDevice();
  const reportA = await report(a.c, 47.51);
  await jam(a.c);
  check((must(await a.c.auth.getUser()) as { user: { is_anonymous?: boolean } }).user.is_anonymous === true, 'indulás: névtelen felhasználó');
  check((await a.c.from('account_fields').insert({ key: 'x', value: 1, updated_ms: 1 })).error !== null, 'névtelen felhasználónak nincs fiókhoz kötött adata');
  // a megerősített e-mail hatása (a levélben lévő link ugyanezt teszi): a felhasználó nem cserélődik
  must(await admin.auth.admin.updateUserById(a.id, { email: emailOf('a'), email_confirm: true }));
  must(await a.c.auth.refreshSession());
  const userA = (must(await a.c.auth.getUser()) as { user: { id: string; is_anonymous?: boolean; email?: string } }).user;
  check(userA.id === a.id && userA.is_anonymous === false && userA.email === emailOf('a'), 'névtelen → fiók: ugyanaz az azonosító, már nem névtelen', userA);
  check((await rowsOf('reports', 'user_id', a.id)) === 1 && (await rowsOf('jam_samples', 'user_id', a.id)) === 1, 'névtelen → fiók: a bejelentés és a dugó-minta megmaradt');

  // 2. második készülék, saját névtelen adatokkal, ugyanabba a fiókba lép: összefésülés
  const b = await anonDevice();
  const reportB = await report(b.c, 47.52);
  await jam(b.c);
  must(await b.c.from('report_votes').insert({ report_id: reportA, confirm: true }));
  const sent: string[] = [];
  const realOtp = b.c.auth.signInWithOtp.bind(b.c.auth);
  b.c.auth.signInWithOtp = (async (p: { email: string }) => {
    sent.push(p.email);
    return { data: { user: null, session: null }, error: null };
  }) as unknown as typeof realOtp;
  let pending: string | null = null;
  await startEmailSignIn(b.c, emailOf('a'), 'https://atlagsebesseg.vercel.app/', { setPendingMerge: (t) => (pending = t) });
  check(pending !== null && sent.length === 1, 'már létező e-mail: igazolás készül, és a linket a meglévő fiók kapja', { pending, sent });
  await openMagicLink(b.c, emailOf('a'));
  const merged = await claimMerge(b.c, pending!);
  check(merged.merged === true, 'két készülék: a névtelen beleolvad a fiókba', merged);
  created.delete(b.id);
  check((await rowsOf('reports', 'user_id', a.id)) === 2 && (await rowsOf('jam_samples', 'user_id', a.id)) === 2, 'két készülék: mindkét bejelentés és dugó-minta a fióknál');
  check((await rowsOf('reports', 'user_id', b.id)) === 0, 'két készülék: a névtelen nevén nem maradt sor');
  check(((must(await admin.from('reports').select('id').eq('id', reportB)) as unknown[]).length) === 1, 'két készülék: a második készülék bejelentése megvan');
  check((await rowsOf('report_votes', 'user_id', a.id)) === 0, 'két készülék: a saját bejelentésre leadott szavazat nem marad');
  check((await admin.auth.admin.getUserById(b.id)).error !== null, 'két készülék: a névtelen auth-felhasználó törölve');
  check((await claimMerge(b.c, pending!)).merged === false, 'az igazolás másodszor nem használható');

  // 3. mentett helyek, beállítások, Megszólítás, napló, hőtérkép a két készülék között – valódi RLS-sel
  const ra = supabaseRemote(a.c);
  const rb = supabaseRemote(b.c);
  let fa = noteLocalFields(NO_FIELDS, accountFieldsOf(data()), stamp);
  let fb = noteLocalFields(NO_FIELDS, accountFieldsOf(data()), stamp);
  fa = noteLocalFields(fa, accountFieldsOf(data({ settings: { ...DEFAULT_SETTINGS, egyseg: 'mph', megszolitas: 'Kristof' }, saved: { home: { id: 'h', name: 'Haza', address: '', lat: 47.5, lon: 19 }, work: null, others: [] } })), stamp + 100);
  fb = noteLocalFields(fb, accountFieldsOf(data({ settings: { ...DEFAULT_SETTINGS, terkep: 'vilagos' } })), stamp + 200);
  fa = (await syncFieldsOnce(ra, fa)).state;
  fb = (await syncFieldsOnce(rb, fb)).state;
  fa = (await syncFieldsOnce(ra, fa)).state;
  const da = applyFields(fa, data());
  const db = applyFields(fb, data());
  check(da.settings.egyseg === 'mph' && db.settings.egyseg === 'mph' && da.settings.terkep === 'vilagos' && db.settings.terkep === 'vilagos', 'szinkron ütközés: mezőnként a legutóbb módosított nyer, mindkét készüléken', { da: da.settings, db: db.settings });
  check(db.saved.home?.id === 'h', 'szinkron: a mentett hely átjut a másik készülékre');
  check(db.settings.megszolitas === 'Kristof' && (await ra.pullProfile())?.megszolitas === 'Kristof', 'a Megszólítás a profilba került, és átjut');
  must(await a.c.from('account_fields').upsert({ key: 'settings.egyseg', value: 'kmh', updated_ms: 1 }, { onConflict: 'user_id,key' }));
  check(((must(await a.c.from('account_fields').select('value').eq('key', 'settings.egyseg').single()) as { value: string }).value) === 'mph', 'szinkron ütközés: késve érkező régi írás nem ír felül');

  const sa = memStore([trip(`ta-${stamp}`)], [{ h3: 'x', count: 2, avgKmh: 40, lastT: 5 }]);
  const sb = memStore([trip(`tb-${stamp}`)], [{ h3: 'x', count: 3, avgKmh: 60, lastT: 6 }]);
  await syncBackupOnce(ra, sa.store, NO_CLOUD_STATE, 'dev-a', null, stamp);
  await syncBackupOnce(rb, sb.store, NO_CLOUD_STATE, 'dev-b', null, stamp);
  await syncBackupOnce(ra, sa.store, NO_CLOUD_STATE, 'dev-a', null, stamp + 1);
  check(sa.map.size === 2 && sb.map.size === 2, 'felhős mentés: a két készülék naplója összefésülődik', { a: [...sa.map.keys()], b: [...sb.map.keys()] });
  check(sa.st.remote[0]?.[0]?.count === 3 && sb.st.remote[0]?.[0]?.count === 2, 'felhős mentés: a másik készülék cellái külön érkeznek (nem duplázódnak)');

  // 4. RLS valódi munkamenettel: másik fiók nem lát és nem ír semmit
  const c = device();
  const email2 = emailOf('c');
  const u2 = must(await admin.auth.admin.createUser({ email: email2, email_confirm: true })) as { user: { id: string } };
  created.add(u2.user.id);
  await openMagicLink(c, email2);
  check((must(await c.from('account_fields').select('key')) as unknown[]).length === 0 && (must(await c.from('cloud_trips').select('id')) as unknown[]).length === 0 && (must(await c.from('cloud_heat').select('device_id')) as unknown[]).length === 0 && (must(await c.from('profiles').select('user_id')) as unknown[]).length === 0, 'RLS: másik fiók sorai nem olvashatók');
  check((await c.from('account_fields').insert({ user_id: a.id, key: 'y', value: 1, updated_ms: 1 })).error !== null, 'RLS: másik fiók nevére nem írható');
  const up = await c.from('profiles').update({ megszolitas: 'Betolakodo', megszolitas_ms: stamp * 2 }).eq('user_id', a.id).select('user_id');
  check((up.data ?? []).length === 0 && (await ra.pullProfile())?.megszolitas === 'Kristof', 'RLS: másik fiók profilja nem módosítható');

  // 5. kijelentkezés után új névtelen felhasználó; névtelen nem törölhet fiókot
  const anon2 = await anonDevice();
  const denied = await anon2.c.functions.invoke('account-delete', { method: 'POST' });
  check(denied.error !== null, 'fiók törlése: névtelen munkamenettel tiltott');

  // 6. fiók törlése az éles edge function-nel: minden sor eltűnik
  await deleteAccount(a.c);
  created.delete(a.id);
  check((await admin.auth.admin.getUserById(a.id)).error !== null, 'fiók törlése: az auth-felhasználó eltűnt');
  for (const [t, col] of [['profiles', 'user_id'], ['account_fields', 'user_id'], ['cloud_trips', 'user_id'], ['cloud_heat', 'user_id'], ['reports', 'user_id'], ['report_votes', 'user_id'], ['jam_samples', 'user_id']] as const) {
    check((await rowsOf(t, col, a.id)) === 0, `fiók törlése: a ${t} sorai eltűntek`);
  }
} catch (e) {
  bad++;
  console.error('HIBA', e);
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
}
console.log(`${ok}/${ok + bad} ellenőrzés zöld`);
process.exit(bad ? 1 : 0);
