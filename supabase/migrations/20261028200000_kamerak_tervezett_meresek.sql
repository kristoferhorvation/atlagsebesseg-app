-- A7: fix kamerák és a rendőrség által előre közzétett (tervezett) sebességmérések.
-- Mindkét tábla kliensről csak olvasható; az adatot a service_role tölti (import / edge function).
-- Csak hozzáad: új típus, táblák, függvények, szabályok.

-- ---------------------------------------------------------------------------
-- cameras: fix telepítésű kamerák (HU: VÉDA KKEP-pontok + OSM highway=speed_camera)
-- ---------------------------------------------------------------------------
create type public.camera_type as enum (
  'speed',        -- sebességmérő
  'red_light',    -- piroslámpa-figyelő
  'complex',      -- sebesség + piroslámpa + egyéb (VÉDA komplex ellenőrző pont)
  'section_gate'  -- átlagsebesség-mérő szakasz kapuja
);

create table public.cameras (
  id               text primary key,                         -- pl. 'hu-veda-2015-017', 'osm-node-123'
  country          char(2) not null check (country = upper(country)),
  type             public.camera_type not null,
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  heading          smallint check (heading between 0 and 359),  -- amerre a kamera mér (haladási irány)
  road             text not null default '',
  speed_limit_kmh  smallint check (speed_limit_kmh between 5 and 250),
  source           text not null check (length(source) between 1 and 160),
  source_url       text not null check (source_url ~ '^https?://'),
  source_date      text not null check (source_date ~ '^\d{4}-\d{2}(-\d{2})?$'),
  verified         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index cameras_location_idx on public.cameras (lat, lng);
create index cameras_country_idx on public.cameras (country);

create trigger cameras_updated_at
before update on public.cameras
for each row execute function public.tg_set_updated_at();

alter table public.cameras enable row level security;
create policy "cameras: olvasás mindenkinek"
  on public.cameras for select to anon, authenticated using (true);
revoke all on public.cameras from anon, authenticated;
grant select on public.cameras to anon, authenticated;

create or replace function public.cameras_in_bbox(
  p_south double precision, p_west double precision, p_north double precision, p_east double precision
)
returns setof public.cameras
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.cameras
   where lat between p_south and p_north and lng between p_west and p_east
$$;

grant execute on function public.cameras_in_bbox(double precision, double precision, double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- planned_checks: a rendőrség által előre megnevezett mérési helyszínek
-- (police.hu közlemény / melléklet, pl. Speedmarathon), az úthálózatra illesztve
-- ---------------------------------------------------------------------------
create table public.planned_checks (
  id               text primary key,                         -- a forrás + a sor szövegéből képzett hash
  country          char(2) not null default 'HU' check (country = upper(country)),
  county           text not null check (length(county) between 1 and 80),
  settlement       text,                                      -- km-szelvényes sornál üres lehet
  road_ref         text,                                      -- útszám vagy utcanév
  description      text not null check (length(description) between 1 and 500),  -- a rendőrségi szöveg szó szerint
  -- GeoJSON-geometria: LineString, vagy MultiLineString, ha a hely több vonal (osztott pálya, kereszteződés)
  geometry         jsonb not null check (geometry ->> 'type' in ('LineString', 'MultiLineString')),
  -- a geometria befoglaló téglalapja (a bbox-lekéréshez)
  min_lat          double precision not null,
  min_lng          double precision not null,
  max_lat          double precision not null,
  max_lng          double precision not null,
  speed_limit_kmh  smallint not null check (speed_limit_kmh between 5 and 250),
  limit_source     text not null check (limit_source in ('osm', 'kresz_default')),
  valid_from       timestamptz not null,
  valid_to         timestamptz not null,
  time_window      text check (time_window is null or length(time_window) between 1 and 80),  -- pl. '06:00–06:00'
  source_url       text not null check (source_url ~ '^https?://'),
  fetched_at       timestamptz not null default now(),
  check (valid_to > valid_from),
  check (min_lat <= max_lat and min_lng <= max_lng)
);

create index planned_checks_valid_to_idx on public.planned_checks (valid_to);
create index planned_checks_bbox_idx on public.planned_checks (min_lat, max_lat, min_lng, max_lng);

alter table public.planned_checks enable row level security;
-- a lejárt sort a kliens nem látja (a következő futás törli)
create policy "planned_checks: olvasás mindenkinek, ha nem járt le"
  on public.planned_checks for select to anon, authenticated using (valid_to > now());
revoke all on public.planned_checks from anon, authenticated;
grant select on public.planned_checks to anon, authenticated;

create or replace function public.planned_checks_in_bbox(
  p_south double precision, p_west double precision, p_north double precision, p_east double precision
)
returns setof public.planned_checks
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.planned_checks
   where valid_to > now()
     and max_lat >= p_south and min_lat <= p_north
     and max_lng >= p_west and min_lng <= p_east
$$;

grant execute on function public.planned_checks_in_bbox(double precision, double precision, double precision, double precision) to anon, authenticated;

-- A fetch-planned-checks futásainak naplója (csak service_role): mit talált, mit nem tudott elhelyezni.
create table public.planned_check_runs (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  summary     jsonb not null default '{}'::jsonb,
  error       text
);
alter table public.planned_check_runs enable row level security;
revoke all on public.planned_check_runs from anon, authenticated;
