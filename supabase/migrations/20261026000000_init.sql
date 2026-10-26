-- Átlagsebesség-app – kezdeti séma
-- sections: átlagsebesség-mérő szakaszok (OSM / hivatalos / közösségi)
-- reports:  közösségi bejelentések, report_votes: megerősítés / cáfolat (felhasználónként egy szavazat)

-- ---------------------------------------------------------------------------
-- Típusok
-- ---------------------------------------------------------------------------
create type public.section_source as enum ('osm', 'hivatalos', 'kozosseg');

create type public.report_type as enum (
  'traffipax',        -- mobil sebességmérő
  'rendorseg',
  'baleset',
  'akadaly',
  'utlezaras',
  'szakasz_hiba'      -- egy átlagsebesség-szakasz adata hibás / megszűnt
);

-- ---------------------------------------------------------------------------
-- sections
-- ---------------------------------------------------------------------------
create table public.sections (
  id               text primary key,                       -- pl. 'osm-123456'
  country          char(2) not null check (country = upper(country)),
  road             text not null default '',
  direction        text not null default '',
  start_lat        double precision not null check (start_lat between -90 and 90),
  start_lon        double precision not null check (start_lon between -180 and 180),
  end_lat          double precision not null check (end_lat between -90 and 90),
  end_lon          double precision not null check (end_lon between -180 and 180),
  length_m         integer not null check (length_m > 0),
  speed_limit_kmh  smallint not null check (speed_limit_kmh between 5 and 250),
  source           public.section_source not null,
  verified         boolean not null default false,
  -- az út vonala a haladási irányban: [[lon, lat], ...] (GeoJSON LineString-koordináták)
  geometry         jsonb,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index sections_country_idx on public.sections (country);
create index sections_start_idx on public.sections (start_lat, start_lon);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  type            public.report_type not null,
  lat             double precision not null check (lat between -90 and 90),
  lon             double precision not null check (lon between -180 and 180),
  heading_deg     smallint check (heading_deg between 0 and 359),   -- haladási irány, amerre érvényes
  section_id      text references public.sections (id) on delete set null,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  confirmations   integer not null default 0 check (confirmations >= 0),
  denials         integer not null default 0 check (denials >= 0),
  expires_at      timestamptz not null default now() + interval '2 hours',
  check (expires_at > created_at)
);

create index reports_expires_idx on public.reports (expires_at);
create index reports_location_idx on public.reports (lat, lon);
create index reports_user_idx on public.reports (user_id);

-- Megerősítés / cáfolat: felhasználónként és bejelentésenként egy szavazat.
-- A számlálókat (confirmations, denials) trigger tartja karban, így közvetlenül nem írhatók.
create table public.report_votes (
  report_id   uuid not null references public.reports (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  confirm     boolean not null,                        -- true = megerősítés, false = cáfolat
  created_at  timestamptz not null default now(),
  primary key (report_id, user_id)
);

create or replace function public.tg_report_votes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.reports
       set confirmations = confirmations - (case when old.confirm then 1 else 0 end),
           denials       = denials       - (case when old.confirm then 0 else 1 end)
     where id = old.report_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.reports
       set confirmations = confirmations + (case when new.confirm then 1 else 0 end),
           denials       = denials       + (case when new.confirm then 0 else 1 end),
           -- megerősítés meghosszabbítja az érvényességet
           expires_at    = case when new.confirm then greatest(expires_at, now() + interval '1 hour') else expires_at end
     where id = new.report_id;
  end if;
  return null;
end;
$$;

create trigger report_votes_count
after insert or update or delete on public.report_votes
for each row execute function public.tg_report_votes_count();

-- A bejelentő a számlálókat és a szerzőt nem írhatja át.
create or replace function public.tg_reports_protect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.confirmations := 0;
    new.denials := 0;
  elsif current_user in ('anon', 'authenticated') then
    new.confirmations := old.confirmations;
    new.denials := old.denials;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger reports_protect
before insert or update on public.reports
for each row execute function public.tg_reports_protect();

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger sections_updated_at
before update on public.sections
for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: olvasás mindenkinek; írás csak bejelentkezve; törlés csak a saját bejelentésre
-- ---------------------------------------------------------------------------
alter table public.sections enable row level security;
alter table public.reports enable row level security;
alter table public.report_votes enable row level security;

-- sections
create policy "sections: olvasás mindenkinek"
  on public.sections for select to anon, authenticated using (true);
create policy "sections: beszúrás bejelentkezve (csak közösségi, nem ellenőrzött)"
  on public.sections for insert to authenticated
  with check (source = 'kozosseg' and verified = false and created_by = auth.uid());
create policy "sections: módosítás a saját közösségi szakaszon"
  on public.sections for update to authenticated
  using (created_by = auth.uid() and source = 'kozosseg')
  with check (created_by = auth.uid() and source = 'kozosseg' and verified = false);
-- sections törlése: csak service_role (RLS megkerülésével, pl. import).

-- reports
create policy "reports: olvasás mindenkinek"
  on public.reports for select to anon, authenticated using (true);
create policy "reports: beszúrás bejelentkezve, saját névre"
  on public.reports for insert to authenticated with check (user_id = auth.uid());
create policy "reports: módosítás csak a sajátot"
  on public.reports for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reports: törlés csak a sajátot"
  on public.reports for delete to authenticated using (user_id = auth.uid());

-- report_votes
create policy "report_votes: olvasás mindenkinek"
  on public.report_votes for select to anon, authenticated using (true);
create policy "report_votes: szavazás bejelentkezve, saját névre, nem a saját bejelentésre"
  on public.report_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid())
  );
create policy "report_votes: saját szavazat módosítása"
  on public.report_votes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "report_votes: saját szavazat visszavonása"
  on public.report_votes for delete to authenticated using (user_id = auth.uid());

-- Jogosultságok (a Supabase alapból ad, itt explicit és szűkített)
revoke all on public.sections, public.reports, public.report_votes from anon, authenticated;
grant select on public.sections, public.reports, public.report_votes to anon, authenticated;
grant insert, update on public.sections to authenticated;
grant insert, update, delete on public.reports to authenticated;
grant insert, update, delete on public.report_votes to authenticated;

-- Aktív (le nem járt) bejelentések nézete az app számára
create view public.active_reports
with (security_invoker = true) as
  select * from public.reports where expires_at > now();

grant select on public.active_reports to anon, authenticated;
