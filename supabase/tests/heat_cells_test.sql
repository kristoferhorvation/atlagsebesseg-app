-- AW20: heat_cells RLS és az aggregált heat_global / heat_global_r8 nézet. Futtatás: tests/run-local.sh vagy tests/run-live.sh (ROLLBACK).
\set QUIET on

create function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'HIBA: % – nem dobott hibát', label;
exception when insufficient_privilege or check_violation or others then
  if sqlerrm like 'HIBA:%' then raise; end if;
  raise notice 'OK  %  (%)', label, sqlerrm;
end $$;

create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'HIBA: %', label; end if;
  raise notice 'OK  %', label;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- tesztcellák: a valódi adatokat nem érintik (kitalált, a tengeren lévő azonosítók)
set role anon;
insert into public.heat_cells (h3, h3_r8, lat, lon, count, avg_speed, hour, dow) values
  ('8a1fb46622dffff', '881fb46623fffff', 47.5, 19.05, 2, 80, 8, 1),
  ('8a1fb46622dffff', '881fb46623fffff', 47.5, 19.05, 1, 110, 17, 2),
  ('8a1fb46622dffff', '881fb46623fffff', 47.5, 19.05, 1, 50, 18, 2),
  ('8a1fb4662137fff', '881fb46623fffff', 47.6, 19.06, 4, 60, 9, 3);
select pg_temp.expect(true, 'anon beszúrhat aggregált sort');
select pg_temp.expect_error($$select * from public.heat_cells$$, 'anon a táblát közvetlenül nem olvashatja');
select pg_temp.expect_error($$update public.heat_cells set count = 1$$, 'anon nem módosíthat');
select pg_temp.expect_error($$delete from public.heat_cells$$, 'anon nem törölhet');
select pg_temp.expect_error($$insert into public.heat_cells (h3, h3_r8, lat, lon, count, avg_speed, hour, dow) values ('8a1fb46622dffff', '881fb46623fffff', 47.5, 19.05, 1, 80, 24, 1)$$, 'hibás óra nem írható');
select pg_temp.expect_error($$insert into public.heat_cells (h3, h3_r8, lat, lon, count, avg_speed, hour, dow) values ('nem-h3', '881fb46623fffff', 47.5, 19.05, 1, 80, 8, 1)$$, 'hibás cella-azonosító nem írható');
select pg_temp.expect_error($$insert into public.heat_cells (h3, h3_r8, lat, lon, count, avg_speed, hour, dow) values ('8a1fb46622dffff', '881fb46623fffff', 47.5, 19.05, 1, 400, 8, 1)$$, 'hibás sebesség nem írható');
-- a nézet: csak a legalább 3 beküldésű cella, súlyozott átlaggal
select pg_temp.expect((select count(*) from public.heat_global where h3 = '8a1fb46622dffff') = 1, 'heat_global: a 3 beküldésű cella látszik');
select pg_temp.expect((select count(*) from public.heat_global where h3 = '8a1fb4662137fff') = 0, 'heat_global: az 1 beküldésű cella nem látszik');
select pg_temp.expect((select count from public.heat_global where h3 = '8a1fb46622dffff') = 4, 'heat_global: az áthaladások összege');
select pg_temp.expect((select abs(avg_speed - 80) < 0.01 from public.heat_global where h3 = '8a1fb46622dffff'), 'heat_global: az átlagsebesség súlyozott');
select pg_temp.expect((select count from public.heat_global_r8 where h3 = '881fb46623fffff') = 8, 'heat_global_r8: a res-8 összegzés');
reset role;

set role authenticated;
select pg_temp.expect_error($$select * from public.heat_cells$$, 'bejelentkezve sem olvasható a tábla');
select pg_temp.expect((select count(*) from public.heat_global) >= 1, 'heat_global olvasható bejelentkezve is');
reset role;
\echo 'heat_cells-teszt: minden ellenőrzés zöld'
