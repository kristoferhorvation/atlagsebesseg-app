-- AW22: valódi (nem kötelező) fiók: profil, fiókhoz kötött szinkron (mezőnként a legutóbb módosított nyer), felhős napló + hőtérkép,
-- névtelen felhasználó összefésülése egy már létező fiókba. Csak hozzáad; a meglévő sorok nem változnak.

-- A valódi (nem névtelen) fiók feltétele a saját adatokhoz.
create or replace function public.is_real_account()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- ---------------------------------------------------------------------------
-- profiles: a Megszólítás és a szolgáltatótól kapott név (az Apple csak az első engedélyezéskor adja át, később nem kérhető le)
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  megszolitas    text not null default '' check (char_length(megszolitas) <= 24),
  megszolitas_ms bigint not null default 0,
  given_name     text check (char_length(given_name) <= 200),
  full_name      text check (char_length(full_name) <= 400),
  name_prompted  boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace function public.tg_profiles_merge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- a legutóbb módosított Megszólítás nyer; a szolgáltató neve üressel nem írható felül; az „Így szólítsunk?” lépés nem jön vissza
  if new.megszolitas_ms < old.megszolitas_ms then
    new.megszolitas := old.megszolitas;
    new.megszolitas_ms := old.megszolitas_ms;
  end if;
  new.given_name := coalesce(new.given_name, old.given_name);
  new.full_name := coalesce(new.full_name, old.full_name);
  new.name_prompted := new.name_prompted or old.name_prompted;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_merge
before update on public.profiles
for each row execute function public.tg_profiles_merge();

-- ---------------------------------------------------------------------------
-- account_fields: szinkronizált mezők (beállítás, mentett hely, zóna, legutóbbi célok); kulcsonként a legutóbb módosított nyer
-- ---------------------------------------------------------------------------
create table public.account_fields (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 160),
  value      jsonb,
  updated_ms bigint not null check (updated_ms >= 0),
  primary key (user_id, key),
  check (pg_column_size(value) <= 32768)
);

-- Régebbi írás (másik készülék, késve érkező feltöltés) nem írja felül az újabbat; azonos időnél a szerveren lévő marad.
create or replace function public.tg_account_fields_lww()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_ms <= old.updated_ms then return null; end if;
  return new;
end;
$$;

create trigger account_fields_lww
before update on public.account_fields
for each row execute function public.tg_account_fields_lww();

-- ---------------------------------------------------------------------------
-- cloud_trips / cloud_heat: a napló és a saját hőtérkép felhős mentése (külön kapcsoló, alapból KI)
-- ---------------------------------------------------------------------------
create table public.cloud_trips (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 80),
  record     jsonb,
  samples    jsonb,
  deleted    boolean not null default false,
  updated_ms bigint not null,
  primary key (user_id, id),
  -- a törölt út csak jelölő: tartalom nem marad a szerveren
  check (not deleted or (record is null and samples is null))
);

-- Készülékenként egy sor: a készülék a sajátját írja felül, a többit csak olvassa – így a számlálók nem duplázódnak.
create table public.cloud_heat (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id  text not null check (char_length(device_id) between 1 and 80),
  cells      jsonb not null,
  updated_ms bigint not null,
  primary key (user_id, device_id)
);

-- ---------------------------------------------------------------------------
-- RLS: mindenki csak a sajátját; a névtelen felhasználónak nincs fiókhoz kötött adata
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.account_fields enable row level security;
alter table public.cloud_trips enable row level security;
alter table public.cloud_heat enable row level security;

create policy "profiles: csak a saját" on public.profiles for all to authenticated
  using (user_id = auth.uid() and public.is_real_account()) with check (user_id = auth.uid() and public.is_real_account());
create policy "account_fields: csak a saját" on public.account_fields for all to authenticated
  using (user_id = auth.uid() and public.is_real_account()) with check (user_id = auth.uid() and public.is_real_account());
create policy "cloud_trips: csak a saját" on public.cloud_trips for all to authenticated
  using (user_id = auth.uid() and public.is_real_account()) with check (user_id = auth.uid() and public.is_real_account());
create policy "cloud_heat: csak a saját" on public.cloud_heat for all to authenticated
  using (user_id = auth.uid() and public.is_real_account()) with check (user_id = auth.uid() and public.is_real_account());

revoke all on public.profiles, public.account_fields, public.cloud_trips, public.cloud_heat from anon;
grant select, insert, update, delete on public.profiles, public.account_fields, public.cloud_trips, public.cloud_heat to authenticated;

-- ---------------------------------------------------------------------------
-- Összefésülés: a névtelen felhasználó (másik készülék, már létező fiók) minden sora a fiókhoz kerül
-- ---------------------------------------------------------------------------
-- A szavazat átvitele nem számol újra (és nem hosszabbítja a bejelentést): a számláló csak a `confirm` változására fut.
drop trigger report_votes_count on public.report_votes;
create trigger report_votes_count
after insert or delete or update of confirm on public.report_votes
for each row execute function public.tg_report_votes_count();

-- Egyszer használható igazolás: a névtelen munkamenet állítja ki, a bejelentkezett fiók váltja be. Kliensről nem olvasható.
create table public.account_merge_tokens (
  token      uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.account_merge_tokens enable row level security;
revoke all on public.account_merge_tokens from anon, authenticated;

create or replace function public.account_merge_prepare()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare t uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'csak névtelen munkamenet adhat ki összefésülési igazolást' using errcode = '42501';
  end if;
  delete from public.account_merge_tokens where from_user = auth.uid() or expires_at < now();
  insert into public.account_merge_tokens (from_user) values (auth.uid()) returning token into t;
  return t;
end;
$$;

create or replace function public.account_merge_claim(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := auth.uid();
  src uuid;
  n_reports int;
  n_votes int;
  n_jams int;
begin
  if not public.is_real_account() then
    raise exception 'csak valódi fiók válthatja be az igazolást' using errcode = '42501';
  end if;
  delete from public.account_merge_tokens where token = p_token and expires_at >= now() returning from_user into src;
  if src is null or src = target then return jsonb_build_object('merged', false); end if;
  -- csak névtelen felhasználó olvad be: egy azóta valódivá vált fiók adatai nem kerülhetnek másikhoz
  if not exists (select 1 from auth.users where id = src and is_anonymous) then return jsonb_build_object('merged', false); end if;

  update public.reports set user_id = target where user_id = src;
  get diagnostics n_reports = row_count;

  -- egy bejelentésre egy szavazat: ahol a fiók már szavazott, az övé marad (a névtelené a törléssel, helyes számlálással esik ki)
  update public.report_votes v set user_id = target
   where v.user_id = src
     and not exists (select 1 from public.report_votes o where o.report_id = v.report_id and o.user_id = target);
  get diagnostics n_votes = row_count;
  delete from public.report_votes where user_id = src;
  -- a saját bejelentésre nem lehet szavazni: ami az összevonással azzá vált, kiesik
  delete from public.report_votes v using public.reports r where v.report_id = r.id and v.user_id = target and r.user_id = target;

  update public.jam_samples set user_id = target where user_id = src;
  get diagnostics n_jams = row_count;
  update public.sections set created_by = target where created_by = src;

  insert into public.profiles (user_id, megszolitas, megszolitas_ms, given_name, full_name, name_prompted)
    select target, megszolitas, megszolitas_ms, given_name, full_name, name_prompted from public.profiles where user_id = src
    on conflict (user_id) do update set
      megszolitas = case when public.profiles.megszolitas = '' then excluded.megszolitas else public.profiles.megszolitas end,
      megszolitas_ms = case when public.profiles.megszolitas = '' then excluded.megszolitas_ms else public.profiles.megszolitas_ms end,
      given_name = excluded.given_name,
      full_name = excluded.full_name;
  insert into public.account_fields (user_id, key, value, updated_ms)
    select target, key, value, updated_ms from public.account_fields where user_id = src
    on conflict (user_id, key) do update set value = excluded.value, updated_ms = excluded.updated_ms;
  insert into public.cloud_trips (user_id, id, record, samples, deleted, updated_ms)
    select target, id, record, samples, deleted, updated_ms from public.cloud_trips where user_id = src
    on conflict (user_id, id) do update set record = excluded.record, samples = excluded.samples, deleted = excluded.deleted, updated_ms = excluded.updated_ms
      where excluded.updated_ms > public.cloud_trips.updated_ms;
  insert into public.cloud_heat (user_id, device_id, cells, updated_ms)
    select target, device_id, cells, updated_ms from public.cloud_heat where user_id = src
    on conflict (user_id, device_id) do update set cells = excluded.cells, updated_ms = excluded.updated_ms
      where excluded.updated_ms > public.cloud_heat.updated_ms;

  delete from auth.users where id = src;
  return jsonb_build_object('merged', true, 'reports', n_reports, 'votes', n_votes, 'jams', n_jams);
end;
$$;

revoke all on function public.account_merge_prepare() from public, anon;
revoke all on function public.account_merge_claim(uuid) from public, anon;
grant execute on function public.account_merge_prepare() to authenticated;
grant execute on function public.account_merge_claim(uuid) to authenticated;
