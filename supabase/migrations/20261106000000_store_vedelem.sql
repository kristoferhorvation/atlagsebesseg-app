-- AW25: App Store előtti védelem és megőrzés. Csak hozzáad (új tábla, függvény, trigger, ütemezett feladat); meglévő sort nem módosít.
-- 1) Napi kvóta telepítésenként (a névtelen auth-azonosító a telepítés tokenje) a közösségi beszúrásokra: bejelentés, szavazat,
--    dugó-minta, hőtérkép. Az adatbázisban, nem edge functionben: a PostgREST-en át sem kerülhető meg, és a régi buildeket is védi.
--    Munkamenet nélküli (csak anon kulcsos) beszúrás a közösségi táblákba nem megy: azt nem lehetne telepítéshez kötni.
-- 2) Megőrzés: a nyers helyadat 90 nap (bejelentés, szavazat, dugó-minta törlődik; a felhőmentés részletes mintái és nyers
--    pontsora kiürül, az összesítő és az illesztett vonal marad), a fiók törlése 30 napig visszaállítható, a 12 hónapja nem
--    használt, adat nélküli névtelen azonosító törlődik. Naponta 03:17-kor (UTC) fut.
-- 3) Fiók-levelek: üdvözlés (az első valódi, megerősített fióknál) és a törlési kérés visszaigazolása. A küldést az account-email
--    edge function végzi (Resend); a levél hibája a bejelentkezést / törlést soha nem akasztja meg.

-- ---------------------------------------------------------------------------
-- 1) Napi kvóta
-- ---------------------------------------------------------------------------
create table public.insert_quota (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default ((now() at time zone 'utc')::date),
  kind    text not null,
  n       integer not null default 0,
  primary key (user_id, day, kind)
);
alter table public.insert_quota enable row level security;
revoke all on public.insert_quota from anon, authenticated;

-- Sor / nap / telepítés. Egy hosszú autópályás nap (~500 km) ~20 000 útszakasz-sor; egy valós sofőr a korlátot nem éri el.
create or replace function public.quota_limit(kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case kind
    when 'reports' then 30
    when 'report_votes' then 200
    when 'jam_samples' then 300
    when 'heat_segments' then 30000
    when 'heat_cells' then 20000
    else 1000
  end
$$;

-- Utasítás-szintű trigger (egy kötegelt beszúrás egy számlálás). A túllépés az egész utasítást visszagörgeti: a számláló sem nő,
-- a PostgREST HTTP 429-et ad (SQLSTATE PT429), a kliens a sorát megtartja és később újrapróbálja.
create or replace function public.tg_insert_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  added integer;
  total integer;
begin
  if uid is null then
    if jwt_role = 'anon' then
      raise exception 'munkamenet kell: %', tg_table_name using errcode = '42501', hint = 'session';
    end if;
    return null; -- service_role, cron, migráció: nincs kvóta
  end if;
  select count(*) into added from new_rows;
  if added = 0 then
    return null;
  end if;
  insert into public.insert_quota as q (user_id, kind, n) values (uid, tg_table_name, added)
  on conflict (user_id, day, kind) do update set n = q.n + excluded.n
  returning q.n into total;
  if total > public.quota_limit(tg_table_name) then
    raise exception 'napi kvóta túllépve: %', tg_table_name using errcode = 'PT429', hint = 'quota';
  end if;
  return null;
end;
$$;

create trigger reports_quota after insert on public.reports referencing new table as new_rows for each statement execute function public.tg_insert_quota();
create trigger report_votes_quota after insert on public.report_votes referencing new table as new_rows for each statement execute function public.tg_insert_quota();
create trigger jam_samples_quota after insert on public.jam_samples referencing new table as new_rows for each statement execute function public.tg_insert_quota();
create trigger heat_segments_quota after insert on public.heat_segments referencing new table as new_rows for each statement execute function public.tg_insert_quota();
create trigger heat_cells_quota after insert on public.heat_cells referencing new table as new_rows for each statement execute function public.tg_insert_quota();

-- ---------------------------------------------------------------------------
-- 3) Fiók-levelek (a 2a előtt: a törlési kérés triggere ezt hívja)
-- ---------------------------------------------------------------------------
-- Egy levél egyszer (kind + ref). A törlés visszaigazolásánál a ref a kérés ideje, így visszaállítás után az újabb kérés is visszaigazolódik.
create table public.account_emails (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('welcome', 'account_deleted')),
  ref        text not null default '',
  resend_id  text,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.account_emails enable row level security;
revoke all on public.account_emails from anon, authenticated;

-- A pg_net a véglegesítés után küld (visszagörgetett tranzakcióból nem megy ki kérés). Hiba esetén csak figyelmeztetés: az auth-folyamat
-- (bejelentkezés, fiók-átalakítás, törlés) a levél miatt nem bukhat el.
create or replace function public.queue_account_email(uid uuid, kind text, ref text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_emails (user_id, kind, ref) values (uid, kind, ref) on conflict do nothing;
  if not found then
    return;
  end if;
  begin
    perform net.http_post(
      url := 'https://vewendmvvybrlymncdji.supabase.co/functions/v1/account-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'promote_temp_gates_cron_secret')),
      body := jsonb_build_object('kind', kind, 'user_id', uid, 'ref', ref),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'account-email nem indult (%): %', kind, sqlerrm;
  end;
end;
$$;
revoke all on function public.queue_account_email(uuid, text, text) from public, anon, authenticated;

-- Üdvözlés: az első valódi, megerősített e-mail-című fióknál (Apple / Google / e-mail-link, a névtelenből alakított is).
create or replace function public.tg_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_anonymous or coalesce(new.email, '') = '' or new.email_confirmed_at is null then
    return null;
  end if;
  perform public.queue_account_email(new.id, 'welcome');
  return null;
end;
$$;

-- a migráció előtt már valódi fiókok nem kapnak utólagos üdvözlést (pl. egy későbbi e-mail-cserénél)
insert into public.account_emails (user_id, kind)
  select id, 'welcome' from auth.users where not is_anonymous and coalesce(email, '') <> '' and email_confirmed_at is not null
  on conflict do nothing;

create trigger users_welcome_email after insert or update of is_anonymous, email, email_confirmed_at on auth.users
for each row execute function public.tg_welcome_email();

-- ---------------------------------------------------------------------------
-- 2a) Fiók törlése 30 napos visszaállítással
-- ---------------------------------------------------------------------------
-- Az account-delete (service_role) írja, és minden munkamenetet megszüntet. Az újabb bejelentkezés (új munkamenet) visszaállítja
-- a fiókot (a trigger lent), 30 nap után a napi feladat véglegesen törli az auth-felhasználót, a sorai a külső kulcsokon esnek.
create table public.account_deletions (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
create policy account_deletions_own_select on public.account_deletions for select to authenticated using (user_id = auth.uid());
revoke all on public.account_deletions from anon, authenticated;
grant select on public.account_deletions to authenticated;

create or replace function public.tg_account_deletion_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.queue_account_email(new.user_id, 'account_deleted', (extract(epoch from new.requested_at) * 1000)::bigint::text);
  return null;
end;
$$;

create trigger account_deletions_email after insert on public.account_deletions for each row execute function public.tg_account_deletion_email();

create or replace function public.tg_session_restores_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.account_deletions where user_id = new.user_id;
  return null;
end;
$$;

create trigger sessions_restore_account after insert on auth.sessions for each row execute function public.tg_session_restores_account();

-- ---------------------------------------------------------------------------
-- 2b) Megőrzés, naponta
-- ---------------------------------------------------------------------------
create or replace function public.purge_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_reports integer;
  n_votes integer;
  n_jams integer;
  n_samples integer;
  n_tracks integer;
  n_accounts integer;
  n_anon integer;
  cutoff_ms bigint := (extract(epoch from now() - interval '90 days') * 1000)::bigint;
begin
  delete from public.report_votes where created_at < now() - interval '90 days';
  get diagnostics n_votes = row_count;
  delete from public.reports where created_at < now() - interval '90 days';
  get diagnostics n_reports = row_count;
  delete from public.jam_samples where created_at < now() - interval '90 days';
  get diagnostics n_jams = row_count;
  -- a felhőmentés: 90 nap után a részletes minták és a nyers pontsor mennek; az út összesítője (record, benne az egyszerűsített
  -- útvonal) és az illesztett vonal (track.lines) marad
  update public.cloud_trips set samples = null where samples is not null and updated_ms < cutoff_ms;
  get diagnostics n_samples = row_count;
  update public.cloud_tracks set track = jsonb_set(track, '{parts}', '[]'::jsonb)
   where updated_ms < cutoff_ms and jsonb_typeof(track -> 'parts') = 'array' and jsonb_array_length(track -> 'parts') > 0;
  get diagnostics n_tracks = row_count;
  delete from auth.users where id in (select user_id from public.account_deletions where requested_at < now() - interval '30 days');
  get diagnostics n_accounts = row_count;
  -- 12 hónapja nem használt (nincs frissített munkamenete) és semmihez nem kötött névtelen azonosító
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '365 days'
    and not exists (select 1 from auth.sessions s where s.user_id = u.id and greatest(s.refreshed_at at time zone 'utc', s.updated_at, s.created_at) > now() - interval '365 days')
    and not exists (select 1 from public.reports x where x.user_id = u.id)
    and not exists (select 1 from public.report_votes x where x.user_id = u.id)
    and not exists (select 1 from public.jam_samples x where x.user_id = u.id);
  get diagnostics n_anon = row_count;
  delete from public.insert_quota where day < (now() at time zone 'utc')::date - 2;
  return jsonb_build_object('reports', n_reports, 'report_votes', n_votes, 'jam_samples', n_jams, 'cloud_trip_samples', n_samples,
    'cloud_track_parts', n_tracks, 'accounts', n_accounts, 'anonymous', n_anon);
end;
$$;
revoke all on function public.purge_retention() from public, anon, authenticated;

select cron.schedule('purge-retention', '17 3 * * *', $$select public.purge_retention()$$);
