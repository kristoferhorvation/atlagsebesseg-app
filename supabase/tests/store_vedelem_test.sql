-- AW25: napi kvóta, 90 napos megőrzés, 30 napos fiók-visszaállítás, üdvözlő levél egyszer. Tranzakcióban, a végén ROLLBACK (run-tests.sh).
\set QUIET on
insert into auth.users (id, is_anonymous, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', true, now()),
  ('00000000-0000-0000-0000-0000000000a2', false, now()),
  ('00000000-0000-0000-0000-0000000000a3', true, now() - interval '400 days'),
  ('00000000-0000-0000-0000-0000000000a4', true, now() - interval '400 days')
on conflict do nothing;

create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'HIBA: %', label; end if;
  raise notice 'OK  %', label;
end $$;
create function pg_temp.as_user(u uuid, anon boolean default true) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'is_anonymous', anon)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $$;
-- szerep vissza + a JWT-claim ürítése (különben az auth.uid() a korábbi felhasználót adná)
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- kvóta: 30 bejelentés / nap fér, a 31. utasítás 429 (PT429), és nem számít bele
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.reports (type, lat, lon, heading_deg) select 'baleset', 47.5, 19.0, 90 from generate_series(1, 30);
do $$
begin
  insert into public.reports (type, lat, lon, heading_deg) values ('baleset', 47.5, 19.0, 90);
  raise exception 'HIBA: a 31. bejelentés átment';
exception when sqlstate 'PT429' then raise notice 'OK  a 31. bejelentés PT429-cel elutasítva';
end $$;
reset role;
select pg_temp.as_admin();
select pg_temp.expect((select n from public.insert_quota where user_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'reports') = 30, 'a számláló 30, az elutasított nem nőtt');
-- kötegelt hőtérkép-beszúrás egy számlálással; service_role / admin írás kvóta nélkül
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.heat_segments (seg_key, lat1, lon1, lat2, lon2, count, avg_speed, hour, dow)
  select 'seg' || lpad(g::text, 8, '0'), 47.5, 19, 47.5002, 19, 1, 50, 8, 1 from generate_series(1, 500) g;
reset role;
select pg_temp.as_admin();
select pg_temp.expect((select n from public.insert_quota where user_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'heat_segments') = 500, 'a köteg egyszer számol: 500');
insert into public.reports (type, lat, lon, heading_deg, user_id) select 'baleset', 47.5, 19.0, 90, '00000000-0000-0000-0000-0000000000a2' from generate_series(1, 40);
select pg_temp.expect((select count(*) from public.reports where user_id = '00000000-0000-0000-0000-0000000000a2') = 40, 'admin (auth.uid() nélkül) kvóta nélkül írhat');
-- munkamenet nélküli (anon kulcsos) közösségi beszúrás: tiltva, nem kerülheti meg a kvótát
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  insert into public.heat_segments (seg_key, lat1, lon1, lat2, lon2, count, avg_speed, hour, dow) values ('kanon000001', 47.5, 19, 47.5002, 19, 1, 50, 8, 1);
  raise exception 'HIBA: az anon beszúrás átment';
exception when sqlstate '42501' then raise notice 'OK  munkamenet nélküli hőtérkép-beszúrás elutasítva';
end $$;
reset role;
select pg_temp.as_admin();

-- megőrzés: 90 napnál régebbi bejelentés, szavazat, dugó-minta törlődik, a friss marad; a felhőmentés régi mintái nullázódnak
-- (a régi időbélyeghez a created_at-et a szerver idejére állító védő-triggerek a tranzakción belül kikapcsolva)
alter table public.reports disable trigger reports_protect;
alter table public.jam_samples disable trigger jam_samples_protect;
insert into public.reports (id, type, lat, lon, heading_deg, user_id, created_at) values
  ('00000000-0000-0000-0000-00000000b001', 'baleset', 47.5, 19, 90, '00000000-0000-0000-0000-0000000000a1', now() - interval '91 days'),
  ('00000000-0000-0000-0000-00000000b002', 'baleset', 47.5, 19, 90, '00000000-0000-0000-0000-0000000000a1', now() - interval '89 days');
insert into public.jam_samples (kind, lat, lon, heading_deg, avg_kmh, length_m, user_id, created_at) values
  ('erzekelt', 47.5, 19, 90, 10, 500, '00000000-0000-0000-0000-0000000000a1', now() - interval '91 days');
alter table public.reports enable trigger reports_protect;
alter table public.jam_samples enable trigger jam_samples_protect;
insert into public.cloud_trips (user_id, id, record, samples, updated_ms) values
  ('00000000-0000-0000-0000-0000000000a2', 'regi', '{"a":1}', '[1]', (extract(epoch from now() - interval '91 days') * 1000)::bigint),
  ('00000000-0000-0000-0000-0000000000a2', 'friss', '{"a":1}', '[1]', (extract(epoch from now()) * 1000)::bigint);
insert into public.cloud_tracks (user_id, trip_id, track, matcher, updated_ms) values
  ('00000000-0000-0000-0000-0000000000a2', 'regi', '{"parts":[[[47.5,19,0]]],"lines":[{"a":1}]}', 'mapbox', (extract(epoch from now() - interval '91 days') * 1000)::bigint),
  ('00000000-0000-0000-0000-0000000000a2', 'friss', '{"parts":[[[47.5,19,0]]],"lines":[{"a":1}]}', 'mapbox', (extract(epoch from now()) * 1000)::bigint);
-- fiók-törlés: 31 napja kért → törlődik; 5 napja kért → marad; a régi névtelen (a3) törlődik, a régi, de bejelentéssel bíró (a4) marad
insert into auth.users (id, is_anonymous) values ('00000000-0000-0000-0000-0000000000a5', false), ('00000000-0000-0000-0000-0000000000a6', false) on conflict do nothing;
insert into public.account_deletions (user_id, requested_at) values
  ('00000000-0000-0000-0000-0000000000a5', now() - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000a6', now() - interval '5 days');
insert into public.reports (type, lat, lon, heading_deg, user_id) values ('baleset', 47.5, 19, 90, '00000000-0000-0000-0000-0000000000a4');
select public.purge_retention();
select pg_temp.expect(not exists (select 1 from public.reports where id = '00000000-0000-0000-0000-00000000b001'), '91 napos bejelentés törölve');
select pg_temp.expect(exists (select 1 from public.reports where id = '00000000-0000-0000-0000-00000000b002'), '89 napos bejelentés marad');
select pg_temp.expect(not exists (select 1 from public.jam_samples where created_at < now() - interval '90 days'), '91 napos dugó-minta törölve');
select pg_temp.expect((select samples is null from public.cloud_trips where id = 'regi') and (select samples is not null from public.cloud_trips where id = 'friss'), 'felhőmentés: a régi minták nullázva, a friss marad');
select pg_temp.expect((select record is not null from public.cloud_trips where id = 'regi'), 'felhőmentés: a régi út összesítője marad');
select pg_temp.expect((select jsonb_array_length(track -> 'parts') = 0 and jsonb_array_length(track -> 'lines') = 1 from public.cloud_tracks where trip_id = 'regi'), 'felhős vonal: a régi nyers pontsor kiürítve, az illesztett vonal marad');
select pg_temp.expect((select jsonb_array_length(track -> 'parts') = 1 from public.cloud_tracks where trip_id = 'friss'), 'felhős vonal: a friss nyers pontsor marad');
select pg_temp.expect(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a5'), '31 napja törölt fiók véglegesen törölve');
select pg_temp.expect(exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a6'), '5 napja törölt fiók még visszaállítható');
select pg_temp.expect(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a3'), '12 hónapja nem használt, adat nélküli névtelen törölve');
select pg_temp.expect(exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a4'), 'régi névtelen, de bejelentéssel: marad');

-- új munkamenet (újra-bejelentkezés) a fiókot visszaállítja
insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a6', now(), now());
select pg_temp.expect(not exists (select 1 from public.account_deletions where user_id = '00000000-0000-0000-0000-0000000000a6'), 'újra-bejelentkezés: a törlési kérés megszűnt');
select pg_temp.expect((select count(*) from public.account_emails where user_id = '00000000-0000-0000-0000-0000000000a6' and kind = 'account_deleted') = 1, 'törlési kérés: egy visszaigazoló levél');
-- újabb kérés a visszaállítás után: újabb visszaigazolás (más időbélyeg)
insert into public.account_deletions (user_id, requested_at) values ('00000000-0000-0000-0000-0000000000a6', now() + interval '1 minute');
select pg_temp.expect((select count(*) from public.account_emails where user_id = '00000000-0000-0000-0000-0000000000a6' and kind = 'account_deleted') = 2, 'visszaállítás utáni újabb kérés: újabb levél');
-- a kliens a törlési kérést csak olvashatja
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6', false);
do $$
begin
  delete from public.account_deletions;
  raise exception 'HIBA: a kliens törölhette a törlési kérést';
exception when insufficient_privilege then raise notice 'OK  a törlési kérést a kliens nem írhatja';
end $$;
reset role;
select pg_temp.as_admin();

-- üdvözlő levél: csak megerősített, valódi fióknál, egyszer
update auth.users set email = 'a2@example.com', email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000a2';
update auth.users set email_confirmed_at = now() + interval '1 second' where id = '00000000-0000-0000-0000-0000000000a2';
update auth.users set email = 'a1@example.com', email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect((select count(*) from public.account_emails where user_id = '00000000-0000-0000-0000-0000000000a2' and kind = 'welcome') = 1, 'üdvözlés egyszer');
select pg_temp.expect(not exists (select 1 from public.account_emails where user_id = '00000000-0000-0000-0000-0000000000a1'), 'névtelen felhasználó nem kap üdvözlést');
select pg_temp.expect(exists (select 1 from cron.job where jobname = 'purge-retention'), 'a napi megőrzési feladat ütemezve');
