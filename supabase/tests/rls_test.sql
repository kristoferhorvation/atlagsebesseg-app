-- RLS-teszt. Futtatás: tests/run-local.sh vagy tests/run-live.sh (tranzakcióban, a végén ROLLBACK).
\set QUIET on
-- Explicit (id) oszlop: az élő auth.users első oszlopa az instance_id, a többi kötelező mezőnek van alapértéke.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b')
on conflict do nothing;

insert into public.sections (id, country, road, direction, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source, created_by)
values ('test-rls-osm-1', 'IT', 'A1', 'Bologna → Firenze', 44.4, 11.2, 44.3, 11.2, 12000, 130, 'osm', null);

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

-- A felhasználó szimulálása: a JWT-claimeket mindkét formában beállítjuk (tranzakción belül),
-- mert az élő auth.uid() a request.jwt.claims-ből is olvas.
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- A6: hivatalos szakasz csak forrással (service_role-ként is)
select pg_temp.expect_error($$insert into public.sections (id, country, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source, verified) values ('test-hiv-1','IT',44.4,11.2,44.3,11.2,12000,130,'hivatalos',true)$$, 'hivatalos szakasz forrás nélkül nem írható');
insert into public.sections (id, country, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source, verified, source_name, source_url, source_date, located_by)
values ('test-hiv-2', 'IT', 44.4, 11.2, 44.3, 11.2, 12000, 130, 'hivatalos', true, 'Polizia di Stato', 'https://www.poliziadistato.it/', '2026-08', 'km_szelveny');
select pg_temp.expect((select source_name from public.sections_in_bbox(44, 11, 45, 12) where id = 'test-hiv-2') = 'Polizia di Stato', 'sections_in_bbox a forrást is adja');
-- A6 lezárás: a határ forrása
update public.sections set limit_source = 'osm' where id = 'test-hiv-2';
select pg_temp.expect((select limit_source from public.sections_in_bbox(44, 11, 45, 12) where id = 'test-hiv-2') = 'osm', 'sections_in_bbox a határ forrását is adja');
select pg_temp.expect_error($$update public.sections set limit_source = 'becsles' where id = 'test-hiv-2'$$, 'limit_source csak hivatalos/osm');

-- anon: olvashat, nem írhat
set role anon;
select pg_temp.expect((select count(*) from public.sections where id = 'test-rls-osm-1') = 1, 'anon olvassa a szakaszokat');
select pg_temp.expect_error($$insert into public.reports (type, lat, lon) values ('rendorseg', 44, 11)$$, 'anon nem jelenthet be');
select pg_temp.expect_error($$insert into public.sections (id, country, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source) values ('x','IT',1,1,2,2,100,130,'kozosseg')$$, 'anon nem ír szakaszt');
reset role;

-- A felhasználó
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.reports (id, type, lat, lon, heading_deg, confirmations)
values ('11111111-1111-1111-1111-111111111111', 'rendorseg', 44.4, 11.2, 180, 999);
select pg_temp.expect((select confirmations from public.reports where id = '11111111-1111-1111-1111-111111111111') = 0, 'beszúráskor a számláló 0 (nem hamisítható)');
select pg_temp.expect_error($$insert into public.reports (type, lat, lon, user_id) values ('baleset', 44, 11, '00000000-0000-0000-0000-00000000000b')$$, 'más nevében nem jelenthet');
select pg_temp.expect_error($$insert into public.report_votes (report_id, confirm) values ('11111111-1111-1111-1111-111111111111', true)$$, 'saját bejelentést nem erősíthet meg');
select pg_temp.expect_error($$insert into public.sections (id, country, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source) values ('x','IT',1,1,2,2,100,130,'hivatalos')$$, 'bejelentkezve sem írhat hivatalos szakaszt');
insert into public.sections (id, country, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source)
values ('kozosseg-1', 'HU', 47.5, 19.0, 47.4, 19.0, 5000, 110, 'kozosseg');
select pg_temp.expect((select created_by from public.sections where id = 'kozosseg-1') = auth.uid(), 'közösségi szakasz beírható, szerző = auth.uid()');
select pg_temp.expect_error($$insert into public.sections (id, country, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source, source_name, source_url, source_date, located_by) values ('kozosseg-2','HU',47.5,19.0,47.4,19.0,5000,110,'kozosseg','Polizia di Stato','https://x.it','2026-08','koordinata')$$, 'közösségi szakasz nem hivatkozhat hivatalos forrásra');
select pg_temp.expect_error($$insert into public.sections (id, country, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source, limit_source) values ('kozosseg-3','HU',47.5,19.0,47.4,19.0,5000,110,'kozosseg','hivatalos')$$, 'közösségi szakasz nem jelölhet határ-forrást');
update public.sections set length_m = 1 where id = 'test-rls-osm-1';
select pg_temp.expect((select length_m from public.sections where id = 'test-rls-osm-1') = 12000, 'OSM-szakasz nem módosítható');
reset role;

-- B felhasználó
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.report_votes (report_id, confirm) values ('11111111-1111-1111-1111-111111111111', true);
select pg_temp.expect((select confirmations from public.reports where id = '11111111-1111-1111-1111-111111111111') = 1, 'megerősítés növeli a számlálót');
select pg_temp.expect_error($$insert into public.report_votes (report_id, confirm) values ('11111111-1111-1111-1111-111111111111', false)$$, 'kétszer nem szavazhat');
update public.report_votes set confirm = false where report_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect((select (confirmations, denials) = (0, 1) from public.reports where id = '11111111-1111-1111-1111-111111111111'), 'szavazat átfordítása: cáfolat');
update public.reports set confirmations = 500 where id = '11111111-1111-1111-1111-111111111111';
delete from public.reports where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect((select count(*) from public.reports where id = '11111111-1111-1111-1111-111111111111') = 1, 'más bejelentését nem törölheti / módosíthatja');
select pg_temp.expect((select confirmations from public.reports where id = '11111111-1111-1111-1111-111111111111') = 0, 'más bejelentésének számlálója nem írható');
reset role;

-- A felhasználó törli a sajátját
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.reports set confirmations = 77, lat = 44.5 where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect((select (confirmations, lat) = (0, 44.5::float8) from public.reports where id = '11111111-1111-1111-1111-111111111111'), 'saját bejelentés módosítható, a számláló nem');
delete from public.reports where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect((select count(*) from public.reports where id = '11111111-1111-1111-1111-111111111111') = 0, 'saját bejelentés törölhető');
select pg_temp.expect((select count(*) from public.report_votes where report_id = '11111111-1111-1111-1111-111111111111') = 0, 'a szavazatok is törlődnek');
reset role;

set role anon;
select pg_temp.expect((select count(*) from public.active_reports where id = '11111111-1111-1111-1111-111111111111') = 0, 'active_reports nézet olvasható');
-- az app ezeket az oszlopokat kéri (A5): a gate_kind is benne van a nézetben
select pg_temp.expect((select count(*) from (select id, type, lat, lon, heading_deg, gate_kind, confirmations, denials, created_at, expires_at, user_id from public.active_reports) t) >= 0, 'active_reports: gate_kind és created_at olvasható');
reset role;
\echo 'RLS-teszt: minden ellenőrzés zöld'
