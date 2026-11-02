-- AW20: közösségi hőtérkép (opt-in). Az app – csak bekapcsolt megosztásnál – az út végén cellánkénti aggregátumot küld:
-- H3 res-10 cella (+ a res-8 szülője és a középpontja, hogy a térképrészre lehessen lekérni), áthaladások száma,
-- átlagsebesség, óra-sáv (0–23) és a hét napja (0 = vasárnap). NINCS útvonal, pontos idő, felhasználó-azonosító vagy
-- sorrend: a sorok egymással nem kapcsolhatók össze. Az út első és utolsó 300 m-ének cellái a kliensen kiszűrődnek.
-- RLS: beszúrás bárkinek (anon vagy bejelentkezett), a táblát SENKI nem olvashatja közvetlenül; olvasás csak az aggregált
-- nézeteken át (`heat_global` res-10, `heat_global_r8` kicsinyítéshez). A nézet csak a legalább 3 beküldésű cellát adja ki.

create table public.heat_cells (
  id         bigint generated always as identity primary key,
  h3         text not null check (h3 ~ '^[0-9a-f]{15}$'),
  h3_r8      text not null check (h3_r8 ~ '^[0-9a-f]{15}$'),
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  count      smallint not null check (count between 1 and 500),
  avg_speed  real not null check (avg_speed between 0 and 250),
  hour       smallint not null check (hour between 0 and 23),
  dow        smallint not null check (dow between 0 and 6)
);

-- nincs created_at: az idő sem kerül a sorba (a beküldések sorrendje sem visszafejthető az id-ből: lásd a nézetet, ami
-- csak összegez). Az id csak a sor azonosítója.
create index heat_cells_h3_idx on public.heat_cells (h3);
create index heat_cells_r8_idx on public.heat_cells (h3_r8);
create index heat_cells_location_idx on public.heat_cells (lat, lon);

alter table public.heat_cells enable row level security;

create policy "heat_cells: beszúrás bárkinek"
  on public.heat_cells for insert to anon, authenticated with check (true);
-- olvasási policy nincs: a tábla közvetlenül nem olvasható

revoke all on public.heat_cells from anon, authenticated;
grant insert on public.heat_cells to anon, authenticated;

-- az aggregált nézetek a tábla tulajdonosaként olvasnak (security definer a nézet alapértelmezése), így az RLS-t
-- megkerülik, de csak az összegzett, legalább 3 beküldésű cellát adják ki
create view public.heat_global as
  select h3,
         avg(lat)::double precision as lat,
         avg(lon)::double precision as lon,
         sum(count)::integer as count,
         (sum(avg_speed * count) / sum(count))::real as avg_speed
    from public.heat_cells
   group by h3
  having count(*) >= 3;

create view public.heat_global_r8 as
  select h3_r8 as h3,
         avg(lat)::double precision as lat,
         avg(lon)::double precision as lon,
         sum(count)::integer as count,
         (sum(avg_speed * count) / sum(count))::real as avg_speed
    from public.heat_cells
   group by h3_r8
  having count(*) >= 3;

grant select on public.heat_global, public.heat_global_r8 to anon, authenticated;
