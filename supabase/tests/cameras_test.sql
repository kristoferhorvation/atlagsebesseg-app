-- A7: fix kamerák és tervezett mérések – RLS, bbox, lejárat. Tranzakcióban, a végén ROLLBACK.
\set QUIET on
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1') on conflict do nothing;

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

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- service_role-ként (a teszt-futtató szerepe) tölthető
insert into public.cameras (id, country, type, lat, lng, road, source, source_url, source_date, verified)
values
  ('test-cam-1', 'HU', 'complex', 47.1728, 18.4686, 'M7', 'ORFK (Zsaru Magazin 2015/48)', 'https://www.police.hu/', '2015-11', true),
  ('test-cam-2', 'HU', 'speed', 46.0, 17.0, '61', 'OpenStreetMap', 'https://www.openstreetmap.org/node/1', '2026-10-28', false);
select pg_temp.expect_error($$insert into public.cameras (id, country, type, lat, lng, source, source_url, source_date) values ('test-cam-x','HU','speed',47,19,'x','ftp://x','2026-10')$$, 'kamera: a forrás URL-je http(s)');
select pg_temp.expect_error($$insert into public.cameras (id, country, type, lat, lng, source, source_url, source_date) values ('test-cam-y','HU','mobil',47,19,'x','https://x','2026-10')$$, 'kamera: típus csak speed/red_light/complex/section_gate');

insert into public.planned_checks (id, county, settlement, road_ref, description, geometry, min_lat, min_lng, max_lat, max_lng,
  speed_limit_kmh, limit_source, valid_from, valid_to, source_url)
values
  ('test-pc-aktiv', 'Fejér', 'Székesfehérvár', 'Palotai út', 'Székesfehérvár Palotai út 156.',
   '{"type":"LineString","coordinates":[[18.42,47.20],[18.43,47.21]]}', 47.20, 18.42, 47.21, 18.43,
   50, 'osm', now() - interval '1 day', now() + interval '3 days', 'https://www.police.hu/'),
  ('test-pc-lejart', 'Fejér', 'Tác', 'Fő utca', 'Tác Fő u. 1.',
   '{"type":"LineString","coordinates":[[18.40,47.08],[18.41,47.09]]}', 47.08, 18.40, 47.09, 18.41,
   50, 'kresz_default', now() - interval '10 days', now() - interval '1 day', 'https://www.police.hu/');
select pg_temp.expect_error($$insert into public.planned_checks (id, county, description, geometry, min_lat, min_lng, max_lat, max_lng, speed_limit_kmh, limit_source, valid_from, valid_to, source_url) values ('test-pc-pont','Fejér','x','{"type":"Point","coordinates":[18,47]}',47,18,47,18,50,'osm',now(),now()+interval '1 day','https://x')$$, 'tervezett mérés: a geometria vonal (LineString/MultiLineString)');
select pg_temp.expect_error($$insert into public.planned_checks (id, county, description, geometry, min_lat, min_lng, max_lat, max_lng, speed_limit_kmh, limit_source, valid_from, valid_to, source_url) values ('test-pc-forras','Fejér','x','{"type":"LineString","coordinates":[[18,47],[18.1,47]]}',47,18,47,18.1,50,'becsles',now(),now()+interval '1 day','https://x')$$, 'tervezett mérés: limit_source csak osm/kresz_default');
select pg_temp.expect_error($$insert into public.planned_checks (id, county, description, geometry, min_lat, min_lng, max_lat, max_lng, speed_limit_kmh, limit_source, valid_from, valid_to, source_url) values ('test-pc-ido','Fejér','x','{"type":"LineString","coordinates":[[18,47],[18.1,47]]}',47,18,47,18.1,50,'osm',now(),now()-interval '1 day','https://x')$$, 'tervezett mérés: a lejárat a kezdet után');

-- anon: olvas, nem ír; a lejártat nem látja
set role anon;
select pg_temp.expect((select count(*) from public.cameras_in_bbox(47.0, 18.3, 47.3, 18.6) where id like 'test-cam-%') = 1, 'cameras_in_bbox: csak a téglalapban lévő kamera');
select pg_temp.expect((select count(*) from public.planned_checks where id like 'test-pc-%') = 1, 'planned_checks: a lejárt sort a kliens nem látja');
select pg_temp.expect((select count(*) from public.planned_checks_in_bbox(47.0, 18.0, 47.5, 19.0) where id like 'test-pc-%') = 1, 'planned_checks_in_bbox: csak a le nem járt');
select pg_temp.expect((select count(*) from public.planned_checks_in_bbox(47.205, 18.425, 47.206, 18.426) where id = 'test-pc-aktiv') = 1, 'planned_checks_in_bbox: a vonal befoglalóját metsző kis téglalap is találat');
select pg_temp.expect((select count(*) from public.planned_checks_in_bbox(46.0, 17.0, 46.5, 17.5) where id like 'test-pc-%') = 0, 'planned_checks_in_bbox: távoli téglalap üres');
select pg_temp.expect_error($$insert into public.cameras (id, country, type, lat, lng, source, source_url, source_date) values ('test-cam-anon','HU','speed',47,19,'x','https://x','2026-10')$$, 'anon nem ír kamerát');
select pg_temp.expect_error($$select * from public.planned_check_runs$$, 'anon nem látja a futásnaplót');
reset role;

-- bejelentkezett felhasználó sem ír
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$insert into public.planned_checks (id, county, description, geometry, min_lat, min_lng, max_lat, max_lng, speed_limit_kmh, limit_source, valid_from, valid_to, source_url) values ('test-pc-user','Fejér','x','{"type":"LineString","coordinates":[[18,47],[18.1,47]]}',47,18,47,18.1,50,'osm',now(),now()+interval '1 day','https://x')$$, 'felhasználó nem ír tervezett mérést');
select pg_temp.expect_error($$update public.cameras set verified = true where id = 'test-cam-2'$$, 'felhasználó nem módosít kamerát');
select pg_temp.expect_error($$delete from public.cameras where id = 'test-cam-1'$$, 'felhasználó nem töröl kamerát');
reset role;
select pg_temp.expect((select verified from public.cameras where id = 'test-cam-2') = false, 'a kamera változatlan');

select 'cameras_test zöld' as eredmeny;
