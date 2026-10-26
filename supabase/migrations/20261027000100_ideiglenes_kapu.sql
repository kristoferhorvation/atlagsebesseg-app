-- Ideiglenes kapuk → automatikus közösségi szakasz
--
-- Folyamat:
--   1. A felhasználók `ideiglenes_kapu` bejelentést tesznek (hely + irány + kezdő/záró).
--   2. Mások megerősítik (report_votes). A párosítást és a független megerősítések számolását
--      az SQL végzi: public.temp_gate_ready_pairs().
--   3. Az edge function (supabase/functions/promote-temp-gates) a kész párokra az úthálózatból
--      kiszámolja a köztük futó útvonalat, és a public.temp_gate_create_section() függvénnyel
--      (service_role) létrehozza a `kozosseg` forrású, nem ellenőrzött szakaszt.
--   4. A szakasz 30 nap után lejár, ha egyik kapuját sem erősítik meg újra.

-- ---------------------------------------------------------------------------
-- Konfiguráció (csak service_role írhatja)
-- ---------------------------------------------------------------------------
create table public.app_config (
  key          text primary key,
  value        jsonb not null,
  description  text not null default ''
);

insert into public.app_config (key, value, description) values
  ('temp_gate_min_confirmations', '3',     'Ennyi független megerősítés kell a kapupárhoz (a bejelentőkön kívüli különböző felhasználók)'),
  ('temp_gate_ttl_hours',         '6',     'Ideiglenes kapu bejelentés érvényessége (óra)'),
  ('temp_gate_confirm_hours',     '2',     'Egy megerősítés ennyi órával hosszabbítja a kaput'),
  ('temp_section_ttl_days',       '30',    'A kapupárból létrejött szakasz ennyi nap után lejár új megerősítés nélkül'),
  ('temp_gate_max_heading_diff',  '45',    'A két kapu iránya legfeljebb ennyi fokban térhet el'),
  ('temp_gate_min_distance_m',    '300',   'A két kapu legkisebb távolsága (m)'),
  ('temp_gate_max_distance_m',    '30000', 'A két kapu legnagyobb távolsága (m)');

alter table public.app_config enable row level security;
create policy "app_config: olvasás mindenkinek" on public.app_config for select to anon, authenticated using (true);
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

create or replace function public.config_num(k text)
returns double precision
language sql
stable
set search_path = ''
as $$
  select (value #>> '{}')::double precision from public.app_config where key = k
$$;

-- ---------------------------------------------------------------------------
-- Geodéziai segédfüggvények (PostGIS nélkül)
-- ---------------------------------------------------------------------------
create or replace function public.geo_distance_m(lat1 double precision, lon1 double precision,
                                                 lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2)))
$$;

create or replace function public.geo_bearing_deg(lat1 double precision, lon1 double precision,
                                                  lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select mod(degrees(atan2(
    sin(radians(lon2 - lon1)) * cos(radians(lat2)),
    cos(radians(lat1)) * sin(radians(lat2)) - sin(radians(lat1)) * cos(radians(lat2)) * cos(radians(lon2 - lon1))
  ))::numeric + 360, 360)::double precision
$$;

create or replace function public.angle_diff_deg(a double precision, b double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select least(abs(mod((a - b)::numeric + 720, 360)), 360 - abs(mod((a - b)::numeric + 720, 360)))::double precision
$$;

-- ---------------------------------------------------------------------------
-- reports: kapu-mezők
-- ---------------------------------------------------------------------------
alter table public.reports
  add column gate_kind        public.gate_kind,
  add column road             text check (road is null or length(road) <= 32),
  add column speed_limit_kmh  smallint check (speed_limit_kmh is null or speed_limit_kmh between 5 and 250),
  add constraint reports_gate_fields check (
    (type = 'ideiglenes_kapu') = (gate_kind is not null)
    and (type <> 'ideiglenes_kapu' or heading_deg is not null)
  );

create index reports_gate_idx on public.reports (type, gate_kind, expires_at) where type = 'ideiglenes_kapu';

-- Lejárat típus szerint: ideiglenes kapu 6 óra (konfig), egyéb 2 óra.
create or replace function public.tg_reports_protect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.confirmations := 0;
    new.denials := 0;
    new.created_at := now();
    if new.type = 'ideiglenes_kapu' then
      new.expires_at := now() + make_interval(hours => public.config_num('temp_gate_ttl_hours')::int);
    end if;
  elsif current_user in ('anon', 'authenticated') then
    new.confirmations := old.confirmations;
    new.denials := old.denials;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.expires_at := old.expires_at;
    new.type := old.type;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- sections: lejárat (a kapupárból létrejött szakaszokra)
-- ---------------------------------------------------------------------------
alter table public.sections add column expires_at timestamptz;
create index sections_expires_idx on public.sections (expires_at) where expires_at is not null;

drop policy "sections: olvasás mindenkinek" on public.sections;
create policy "sections: olvasás mindenkinek (le nem járt)"
  on public.sections for select to anon, authenticated
  using (expires_at is null or expires_at > now());

-- A kapupár → szakasz kapcsolat (egy kapu legfeljebb egy szakaszhoz tartozhat).
create table public.temp_gate_sections (
  start_report_id  uuid not null references public.reports (id) on delete cascade,
  end_report_id    uuid not null references public.reports (id) on delete cascade,
  section_id       text references public.sections (id) on delete cascade,
  error            text,
  created_at       timestamptz not null default now(),
  primary key (start_report_id, end_report_id),
  check ((section_id is null) <> (error is null))
);
create unique index temp_gate_sections_start_uq on public.temp_gate_sections (start_report_id) where section_id is not null;
create unique index temp_gate_sections_end_uq on public.temp_gate_sections (end_report_id) where section_id is not null;

alter table public.temp_gate_sections enable row level security;
create policy "temp_gate_sections: olvasás mindenkinek" on public.temp_gate_sections for select to anon, authenticated using (true);
revoke all on public.temp_gate_sections from anon, authenticated;
grant select on public.temp_gate_sections to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Szavazás: kapu megerősítése +2 óra, és a belőle lett szakasz +30 nap
-- ---------------------------------------------------------------------------
create or replace function public.tg_report_votes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r_type public.report_type;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.reports
       set confirmations = confirmations - (case when old.confirm then 1 else 0 end),
           denials       = denials       - (case when old.confirm then 0 else 1 end)
     where id = old.report_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select type into r_type from public.reports where id = new.report_id;
    update public.reports
       set confirmations = confirmations + (case when new.confirm then 1 else 0 end),
           denials       = denials       + (case when new.confirm then 0 else 1 end),
           expires_at    = case
             when not new.confirm then expires_at
             when r_type = 'ideiglenes_kapu'
               then greatest(expires_at, now()) + make_interval(hours => public.config_num('temp_gate_confirm_hours')::int)
             else greatest(expires_at, now() + interval '1 hour')
           end
     where id = new.report_id;
    if new.confirm and r_type = 'ideiglenes_kapu' then
      update public.sections s
         set expires_at = greatest(s.expires_at, now() + make_interval(days => public.config_num('temp_section_ttl_days')::int))
        from public.temp_gate_sections t
       where t.section_id = s.id
         and (t.start_report_id = new.report_id or t.end_report_id = new.report_id);
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Párosítás: kész kapupárok
-- ---------------------------------------------------------------------------
-- Független megerősítés = a két kapu bármelyikét megerősítő KÜLÖNBÖZŐ felhasználók száma,
-- a két bejelentő nélkül. Ha bármelyik kapun több a cáfolat, mint a megerősítés, a pár nem kész.
-- Kezdőkapunként a legközelebbi érvényes zárókapu a pár.
create or replace function public.temp_gate_ready_pairs()
returns table (
  start_report_id      uuid,
  end_report_id        uuid,
  distance_m           double precision,
  independent_confirms integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with gates as (
    select * from public.reports
     where type = 'ideiglenes_kapu' and expires_at > now()
  ),
  pairs as (
    select s.id as sid, e.id as eid, s.user_id as su, e.user_id as eu,
           public.geo_distance_m(s.lat, s.lon, e.lat, e.lon) as dist
      from gates s
      join gates e on e.gate_kind = 'zaro' and s.gate_kind = 'kezdo'
     where (s.road is null or e.road is null or lower(trim(s.road)) = lower(trim(e.road)))
       and public.angle_diff_deg(s.heading_deg, e.heading_deg) <= public.config_num('temp_gate_max_heading_diff')
       -- a zárókapu a kezdőkapu előtt van (a haladási irányban)
       and public.angle_diff_deg(s.heading_deg, public.geo_bearing_deg(s.lat, s.lon, e.lat, e.lon)) <= 60
       and s.denials <= s.confirmations and e.denials <= e.confirmations
       and not exists (
         select 1 from public.temp_gate_sections t
          where (t.section_id is not null and (t.start_report_id in (s.id, e.id) or t.end_report_id in (s.id, e.id)))
             or (t.section_id is null and t.start_report_id = s.id and t.end_report_id = e.id
                 and t.created_at > now() - interval '1 hour')
       )
  ),
  scored as (
    select p.*, (
      select count(distinct v.user_id)::int
        from public.report_votes v
       where v.report_id in (p.sid, p.eid) and v.confirm and v.user_id not in (p.su, p.eu)
    ) as confirms
      from pairs p
     where p.dist between public.config_num('temp_gate_min_distance_m') and public.config_num('temp_gate_max_distance_m')
  )
  select distinct on (sid) sid, eid, dist, confirms
    from scored
   where confirms >= public.config_num('temp_gate_min_confirmations')
   order by sid, dist
$$;

-- Szakasz létrehozása egy kész párból (csak service_role – az edge function hívja a geometriával).
create or replace function public.temp_gate_create_section(
  p_start uuid,
  p_end uuid,
  p_geometry jsonb,
  p_length_m integer,
  p_road text default null,
  p_speed_limit_kmh smallint default null,
  p_country text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reports;
  e public.reports;
  limit_kmh smallint;
  new_id text;
begin
  if not exists (select 1 from public.temp_gate_ready_pairs() r where r.start_report_id = p_start and r.end_report_id = p_end) then
    raise exception 'a kapupár nem kész (megerősítés, irány, távolság vagy lejárat)';
  end if;
  if jsonb_typeof(p_geometry) <> 'array' or jsonb_array_length(p_geometry) < 2 then
    raise exception 'a geometria legalább két [lon, lat] pont';
  end if;
  select * into s from public.reports where id = p_start;
  select * into e from public.reports where id = p_end;
  -- a szigorúbb (kisebb) határ nyer; ha a bejelentésekben nincs, az úthálózatból jövő érték
  limit_kmh := coalesce(least(s.speed_limit_kmh, e.speed_limit_kmh), p_speed_limit_kmh);
  if limit_kmh is null then
    raise exception 'nincs sebességhatár (sem a bejelentésekben, sem az úthálózatban)';
  end if;
  new_id := 'kozosseg-tg-' || left(replace(p_start::text, '-', ''), 12);
  insert into public.sections (id, country, road, direction, start_lat, start_lon, end_lat, end_lon,
                               length_m, speed_limit_kmh, source, verified, geometry, created_by, expires_at)
  values (new_id, upper(coalesce(p_country, 'XX')), coalesce(s.road, e.road, p_road, ''), 'ideiglenes',
          s.lat, s.lon, e.lat, e.lon, p_length_m, limit_kmh, 'kozosseg', false, p_geometry, s.user_id,
          now() + make_interval(days => public.config_num('temp_section_ttl_days')::int));
  -- egy korábbi sikertelen kísérlet sorát felülírja
  insert into public.temp_gate_sections (start_report_id, end_report_id, section_id) values (p_start, p_end, new_id)
  on conflict (start_report_id, end_report_id) do update set section_id = excluded.section_id, error = null, created_at = now();
  return new_id;
end;
$$;

-- Sikertelen geometria-keresés naplózása (1 óráig nem próbálja újra).
create or replace function public.temp_gate_mark_failed(p_start uuid, p_end uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.temp_gate_sections (start_report_id, end_report_id, error)
  values (p_start, p_end, left(p_error, 500))
  on conflict (start_report_id, end_report_id) do update set error = excluded.error, created_at = now()
    where public.temp_gate_sections.section_id is null
$$;

revoke all on function public.temp_gate_ready_pairs() from public, anon, authenticated;
revoke all on function public.temp_gate_create_section(uuid, uuid, jsonb, integer, text, smallint, text) from public, anon, authenticated;
revoke all on function public.temp_gate_mark_failed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.temp_gate_ready_pairs() to service_role;
grant execute on function public.temp_gate_create_section(uuid, uuid, jsonb, integer, text, smallint, text) to service_role;
grant execute on function public.temp_gate_mark_failed(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Szakaszok befoglaló téglalap szerint (az app ezt hívja; RLS érvényes)
-- ---------------------------------------------------------------------------
create or replace function public.sections_in_bbox(
  p_south double precision, p_west double precision, p_north double precision, p_east double precision
)
returns setof public.sections
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.sections
   where (start_lat between p_south and p_north and start_lon between p_west and p_east)
      or (end_lat between p_south and p_north and end_lon between p_west and p_east)
$$;

grant execute on function public.sections_in_bbox(double precision, double precision, double precision, double precision) to anon, authenticated;
