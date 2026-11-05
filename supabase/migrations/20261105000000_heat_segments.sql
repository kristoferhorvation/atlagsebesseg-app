-- AW24: hőtérkép utcákra illesztett csíkokkal. Additív: a régi heat_cells tábla és nézetei érintetlenek (a kliens nem ír és nem olvas belőlük többé).
--
-- heat_segments: a közösségi összesítés útszakaszonként (kb. 25 m az illesztett vonal mentén). Mint a heat_cells: csak bekapcsolt megosztásnál, nincs útvonal, azonosító, pontos idő,
-- a sorok egymással nem kapcsolhatók össze; a mentett helyek zónái és az út első / utolsó 300 m-e a kliensen kiszűrődik. A nézet csak a legalább 3 beküldésű szakaszt adja ki.
-- A szakasz kulcsa a két végpontból áll (kerekítve, irányfüggetlen), a végpontok az úthálózat csúcsaihoz kötöttek.
-- `matcher`: melyik illesztő eredménye (a Mapbox-eredmény így külön törölhető, ha saját illesztőre váltunk).
create table public.heat_segments (
  id        bigint generated always as identity primary key,
  seg_key   text not null check (char_length(seg_key) between 10 and 60),
  lat1      double precision not null check (lat1 between -90 and 90),
  lon1      double precision not null check (lon1 between -180 and 180),
  lat2      double precision not null check (lat2 between -90 and 90),
  lon2      double precision not null check (lon2 between -180 and 180),
  count     smallint not null check (count between 1 and 500),
  avg_speed real not null check (avg_speed between 0 and 250),
  hour      smallint not null check (hour between 0 and 23),
  dow       smallint not null check (dow between 0 and 6),
  matcher   text not null default 'mapbox' check (char_length(matcher) between 1 and 20)
);

create index heat_segments_key_idx on public.heat_segments (seg_key);
create index heat_segments_location_idx on public.heat_segments (lat1, lon1);

alter table public.heat_segments enable row level security;
create policy "heat_segments: beszúrás bárkinek" on public.heat_segments for insert to anon, authenticated with check (true);
revoke all on public.heat_segments from anon, authenticated;
grant insert on public.heat_segments to anon, authenticated;

-- a csoportosítás a koordinátákra is megy: a téglalap-feltétel a nézeten át a táblára (és az indexre) kerül
create view public.heat_segments_global as
  select seg_key, lat1, lon1, lat2, lon2,
         sum(count)::integer as count,
         (sum(avg_speed * count) / sum(count))::real as avg_speed
    from public.heat_segments
   group by seg_key, lat1, lon1, lat2, lon2
  having count(*) >= 3;

grant select on public.heat_segments_global to anon, authenticated;

-- cloud_tracks: a saját utak illesztett geometriája felhasználónként (a felhős mentés része, csak valódi fiók); a nyers pontsorral együtt, hogy más illesztővel újraépíthető legyen.
create table public.cloud_tracks (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id    text not null check (char_length(trip_id) between 1 and 80),
  track      jsonb not null,
  matcher    text,
  updated_ms bigint not null,
  primary key (user_id, trip_id)
);

alter table public.cloud_tracks enable row level security;
create policy "cloud_tracks: csak a saját" on public.cloud_tracks for all to authenticated
  using (user_id = auth.uid() and public.is_real_account()) with check (user_id = auth.uid() and public.is_real_account());
revoke all on public.cloud_tracks from anon;
grant select, insert, update, delete on public.cloud_tracks to authenticated;

-- AW24: profilkép a Beállítások fiók-kártyájához (kicsinyített JPEG data URL, a profil-sorral együtt az RLS védi); a szolgáltató képe (Apple / Google) csak előtöltés.
alter table public.profiles add column avatar text check (avatar is null or char_length(avatar) <= 120000);
