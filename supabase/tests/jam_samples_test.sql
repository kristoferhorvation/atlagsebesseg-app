-- AW18: jam_samples RLS és az active_jams nézet. Futtatás: tests/run-local.sh vagy tests/run-live.sh (ROLLBACK).
\set QUIET on
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b')
on conflict do nothing;

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

set role anon;
select pg_temp.expect_error($$insert into public.jam_samples (kind, lat, lon, heading_deg, avg_kmh, length_m) values ('erzekelt', 47.5, 19.0, 90, 8, 260)$$, 'anon nem tölthet fel dugó-mintát');
reset role;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.jam_samples (id, kind, lat, lon, heading_deg, avg_kmh, length_m, created_at)
values ('22222222-2222-2222-2222-222222222222', 'erzekelt', 47.5, 19.0, 90, 8, 260, now() - interval '1 day');
select pg_temp.expect((select created_at > now() - interval '1 minute' from public.jam_samples where id = '22222222-2222-2222-2222-222222222222'), 'a beszúrás ideje a szerveré (nem hamisítható)');
select pg_temp.expect_error($$insert into public.jam_samples (kind, lat, lon, heading_deg, avg_kmh, length_m, user_id) values ('erzekelt', 47.5, 19.0, 90, 8, 260, '00000000-0000-0000-0000-00000000000b')$$, 'más nevében nem tölthet fel');
select pg_temp.expect_error($$insert into public.jam_samples (kind, lat, lon, heading_deg, avg_kmh, length_m) values ('erzekelt', 47.5, 19.0, 400, 8, 260)$$, 'hibás irány nem írható');
select pg_temp.expect_error($$update public.jam_samples set avg_kmh = 120 where id = '22222222-2222-2222-2222-222222222222'$$, 'a minta nem módosítható');
select pg_temp.expect((select count(*) from public.active_jams where id = '22222222-2222-2222-2222-222222222222') = 1, 'active_jams: a friss minta látszik');
insert into public.reports (type, lat, lon, heading_deg) values ('dugo', 47.5, 19.0, 90), ('beallt', 47.5, 19.0, 90);
select pg_temp.expect((select count(*) from public.reports where type in ('dugo', 'beallt')) = 2, 'új bejelentéstípus: dugo, beallt');
reset role;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from public.jam_samples where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect((select count(*) from public.jam_samples where id = '22222222-2222-2222-2222-222222222222') = 1, 'más mintáját nem törölheti');
reset role;

update public.jam_samples set created_at = now() - interval '16 minutes' where id = '22222222-2222-2222-2222-222222222222';
set role anon;
select pg_temp.expect((select count(*) from public.active_jams where id = '22222222-2222-2222-2222-222222222222') = 0, 'active_jams: a 15 percnél régebbi minta nem látszik');
select pg_temp.expect((select count(*) from (select id, kind, lat, lon, heading_deg, avg_kmh, length_m, user_id, created_at from public.active_jams) t) >= 0, 'active_jams: az app oszlopai olvashatók');
reset role;
\echo 'jam_samples-teszt: minden ellenőrzés zöld'
