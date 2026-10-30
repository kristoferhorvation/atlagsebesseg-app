-- AW18: közösségi dugó-adat. Az app navigáció közben a helyben érzékelt (és a bejelentett) dugót szakaszonként feltölti:
-- a mért szakasz VÉGPONTJA, haladási iránya, a mért átlag és a szakasz hossza. Más felhasználónál a 15 percnél frissebb,
-- azonos irányú minta az érintett szakasz idejét a mért átlaggal felülírja az ETA-ban. Az `oldott` minta a dugó végét
-- (újra normál tempó) jelzi – a frissebb minta nyer.
-- RLS a reports mintájára: olvasás mindenkinek, beszúrás bejelentkezve (anonim is) a saját nevére, törlés csak a sajátot;
-- módosítás nincs.

create type public.jam_kind as enum ('erzekelt', 'bejelentett', 'oldott');

create table public.jam_samples (
  id           uuid primary key default gen_random_uuid(),
  kind         public.jam_kind not null,
  lat          double precision not null check (lat between -90 and 90),
  lon          double precision not null check (lon between -180 and 180),
  heading_deg  smallint check (heading_deg between 0 and 359),
  avg_kmh      smallint not null check (avg_kmh between 0 and 250),
  length_m     integer not null check (length_m between 1 and 20000),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index jam_samples_created_idx on public.jam_samples (created_at);
create index jam_samples_location_idx on public.jam_samples (lat, lon);

-- a beszúrás ideje a szerveré (a kliens nem hamisíthat „friss” mintát)
create or replace function public.tg_jam_samples_protect()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger jam_samples_protect
before insert on public.jam_samples
for each row execute function public.tg_jam_samples_protect();

alter table public.jam_samples enable row level security;

create policy "jam_samples: olvasás mindenkinek"
  on public.jam_samples for select to anon, authenticated using (true);
create policy "jam_samples: beszúrás bejelentkezve, saját névre"
  on public.jam_samples for insert to authenticated with check (user_id = auth.uid());
create policy "jam_samples: törlés csak a sajátot"
  on public.jam_samples for delete to authenticated using (user_id = auth.uid());

revoke all on public.jam_samples from anon, authenticated;
grant select on public.jam_samples to anon, authenticated;
grant insert, delete on public.jam_samples to authenticated;

-- az app ezt olvassa: csak a 15 percnél frissebb minták (explicit oszloplistával, lásd active_reports)
create view public.active_jams
with (security_invoker = true) as
  select id, kind, lat, lon, heading_deg, avg_kmh, length_m, user_id, created_at
    from public.jam_samples
   where created_at > now() - interval '15 minutes';

grant select on public.active_jams to anon, authenticated;
