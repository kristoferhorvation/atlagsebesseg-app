-- AW24: heat_segments / cloud_tracks / profiles.avatar. Tranzakcióban, a végén ROLLBACK (run-tests.sh).
do $$
declare n integer; c integer;
begin
  -- az anon beszúrhat, a tábla közvetlenül nem olvasható, a nézet csak ≥ 3 beküldésnél ad ki
  set local role anon;
  insert into public.heat_segments (seg_key, lat1, lon1, lat2, lon2, count, avg_speed, hour, dow) values ('47.50000,19.00000;47.50020,19.00000', 47.5, 19, 47.5002, 19, 1, 50, 8, 1);
  insert into public.heat_segments (seg_key, lat1, lon1, lat2, lon2, count, avg_speed, hour, dow) values ('47.50000,19.00000;47.50020,19.00000', 47.5, 19, 47.5002, 19, 2, 80, 9, 2);
  select count(*) into n from public.heat_segments_global where seg_key = '47.50000,19.00000;47.50020,19.00000';
  if n <> 0 then raise exception 'a nézet 3 beküldés alatt is kiadta'; end if;
  insert into public.heat_segments (seg_key, lat1, lon1, lat2, lon2, count, avg_speed, hour, dow) values ('47.50000,19.00000;47.50020,19.00000', 47.5, 19, 47.5002, 19, 1, 110, 9, 2);
  select count(*), max(g.count) into n, c from public.heat_segments_global g where seg_key = '47.50000,19.00000;47.50020,19.00000';
  if n <> 1 or c <> 4 then raise exception 'a nézet összege hibás: % %', n, c; end if;
  raise notice 'OK heat_segments: csak beszúrás, a nézet ≥ 3 beküldéstől összegez';
  begin
    perform 1 from public.heat_segments limit 1;
    raise exception 'az anon olvasta a táblát';
  exception when insufficient_privilege then raise notice 'OK heat_segments: a tábla közvetlenül nem olvasható';
  end;
  begin
    perform 1 from public.cloud_tracks limit 1;
    raise exception 'az anon olvasta a cloud_tracks-et';
  exception when insufficient_privilege then raise notice 'OK cloud_tracks: az anon nem éri el';
  end;
  reset role;
  -- a régi heat_cells érintetlen
  perform 1 from information_schema.tables where table_schema = 'public' and table_name = 'heat_cells';
  if not found then raise exception 'a heat_cells eltűnt'; end if;
  raise notice 'OK heat_cells: megmaradt';
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar') then raise exception 'nincs avatar'; end if;
  raise notice 'OK profiles.avatar: megvan';
end $$;
