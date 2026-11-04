-- AW22: fiók – RLS, szinkron ütközés, névtelen → fiók összefésülés, fiók törlése. Futtatás: tests/run-live.sh (tranzakcióban, a végén ROLLBACK).
\set QUIET on
insert into auth.users (id, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000f1', false),
  ('00000000-0000-0000-0000-0000000000f2', false),
  ('00000000-0000-0000-0000-0000000000f3', true),
  ('00000000-0000-0000-0000-0000000000f4', true)
on conflict do nothing;

create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'HIBA: %', label; end if;
  raise notice 'OK  %', label;
end $$;
create function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'HIBA: % – nem dobott hibát', label;
exception when others then
  if sqlerrm like 'HIBA:%' then raise; end if;
  raise notice 'OK  %  (%)', label, sqlerrm;
end $$;
create function pg_temp.as_user(u uuid, anon boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'is_anonymous', anon)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- RLS: más sorai nem olvashatók és nem írhatók
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into public.profiles (megszolitas, megszolitas_ms) values ('Egyes', 100);
insert into public.account_fields (key, value, updated_ms) values ('settings.egyseg', '"mph"', 100);
insert into public.cloud_trips (id, record, updated_ms) values ('t1', '{"a":1}', 100);
insert into public.cloud_heat (device_id, cells, updated_ms) values ('d1', '[]', 100);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select pg_temp.expect((select count(*) from public.profiles) = 0, 'RLS: más profilja nem olvasható');
select pg_temp.expect((select count(*) from public.account_fields) = 0, 'RLS: más mezői nem olvashatók');
select pg_temp.expect((select count(*) from public.cloud_trips) = 0, 'RLS: más útjai nem olvashatók');
select pg_temp.expect((select count(*) from public.cloud_heat) = 0, 'RLS: más hőtérképe nem olvasható');
select pg_temp.expect_error($q$insert into public.profiles (user_id) values ('00000000-0000-0000-0000-0000000000f1')$q$, 'RLS: más nevére nem írható profil');
select pg_temp.expect_error($q$insert into public.account_fields (user_id, key, value, updated_ms) values ('00000000-0000-0000-0000-0000000000f1', 'x', '1', 1)$q$, 'RLS: más nevére nem írható mező');
update public.account_fields set value = '"kmh"', updated_ms = 999 where key = 'settings.egyseg';
delete from public.cloud_trips where id = 't1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select value from public.account_fields where key = 'settings.egyseg') = '"mph"'::jsonb, 'RLS: más mezője nem módosítható');
select pg_temp.expect((select count(*) from public.cloud_trips where id = 't1') = 1, 'RLS: más útja nem törölhető');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3', true);
select pg_temp.expect_error($q$insert into public.account_fields (key, value, updated_ms) values ('x', '1', 1)$q$, 'RLS: névtelen felhasználónak nincs fiókhoz kötött mezője');

-- Szinkron ütközés: mezőnként a legutóbb módosított nyer
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into public.account_fields (key, value, updated_ms) values ('settings.egyseg', '"kmh"', 50)
  on conflict (user_id, key) do update set value = excluded.value, updated_ms = excluded.updated_ms;
select pg_temp.expect((select value from public.account_fields where key = 'settings.egyseg') = '"mph"'::jsonb, 'ütközés: a régebbi írás nem írja felül az újabbat');
insert into public.account_fields (key, value, updated_ms) values ('settings.egyseg', '"kmh"', 200), ('settings.terkep', '"vilagos"', 10)
  on conflict (user_id, key) do update set value = excluded.value, updated_ms = excluded.updated_ms;
select pg_temp.expect((select value from public.account_fields where key = 'settings.egyseg') = '"kmh"'::jsonb, 'ütközés: az újabb írás nyer');
select pg_temp.expect((select count(*) from public.account_fields) = 2, 'ütközés: a másik mező független');
update public.profiles set megszolitas = 'Régi', megszolitas_ms = 50;
select pg_temp.expect((select megszolitas from public.profiles) = 'Egyes', 'profil: a régebbi Megszólítás nem ír felül');
update public.profiles set given_name = 'Kristof', full_name = 'Kristof H' where true;
update public.profiles set given_name = null, full_name = null where true;
select pg_temp.expect((select given_name from public.profiles) = 'Kristof', 'profil: az Apple-től kapott név üressel nem írható felül');

-- Névtelen → fiók összefésülés (két készülék)
select pg_temp.as_admin();
insert into public.reports (id, type, lat, lon, user_id) values
  ('00000000-0000-0000-0000-00000000aa01', 'dugo', 47.5, 19.0, '00000000-0000-0000-0000-0000000000f3'),
  ('00000000-0000-0000-0000-00000000aa02', 'dugo', 47.5, 19.1, '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000aa03', 'dugo', 47.5, 19.2, '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000aa04', 'dugo', 47.5, 19.3, '00000000-0000-0000-0000-0000000000f2');
insert into public.report_votes (report_id, user_id, confirm) values
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-0000000000f3', true),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-0000000000f3', true),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-0000000000f3', false),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-0000000000f1', true);
insert into public.jam_samples (kind, lat, lon, avg_kmh, length_m, user_id) values ('erzekelt', 47.5, 19.0, 10, 500, '00000000-0000-0000-0000-0000000000f3');
update public.reports set expires_at = now() + interval '1 minute' where id = '00000000-0000-0000-0000-00000000aa03';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error($q$select public.account_merge_prepare()$q$, 'összefésülés: valódi fiók nem adhat ki igazolást');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3', true);
select set_config('app.merge_token', public.account_merge_prepare()::text, true);
select pg_temp.expect_error($q$select public.account_merge_claim(current_setting('app.merge_token')::uuid)$q$, 'összefésülés: névtelen nem válthat be');
select pg_temp.expect_error($q$select * from public.account_merge_tokens$q$, 'összefésülés: az igazolás kliensről nem olvasható');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((public.account_merge_claim('00000000-0000-0000-0000-000000000000') ->> 'merged')::boolean = false, 'összefésülés: ismeretlen igazolás nem ér semmit');
select pg_temp.expect((public.account_merge_claim(current_setting('app.merge_token')::uuid) ->> 'merged')::boolean, 'összefésülés: a fiók beváltja az igazolást');
select pg_temp.expect((public.account_merge_claim(current_setting('app.merge_token')::uuid) ->> 'merged')::boolean = false, 'összefésülés: az igazolás egyszer használható');
select pg_temp.as_admin();
select pg_temp.expect((select user_id from public.reports where id = '00000000-0000-0000-0000-00000000aa01') = '00000000-0000-0000-0000-0000000000f1', 'összefésülés: a névtelen bejelentése a fiókhoz került');
select pg_temp.expect((select count(*) from public.jam_samples where user_id = '00000000-0000-0000-0000-0000000000f1') = 1, 'összefésülés: a dugó-minta a fiókhoz került');
select pg_temp.expect((select confirm from public.report_votes where report_id = '00000000-0000-0000-0000-00000000aa03' and user_id = '00000000-0000-0000-0000-0000000000f1'), 'összefésülés: a szavazat a fiókhoz került');
select pg_temp.expect((select confirmations from public.reports where id = '00000000-0000-0000-0000-00000000aa03') = 1, 'összefésülés: a számláló nem változott');
select pg_temp.expect((select expires_at from public.reports where id = '00000000-0000-0000-0000-00000000aa03') < now() + interval '30 minutes', 'összefésülés: a bejelentés nem hosszabbodik meg');
select pg_temp.expect((select confirm from public.report_votes where report_id = '00000000-0000-0000-0000-00000000aa04' and user_id = '00000000-0000-0000-0000-0000000000f1'), 'összefésülés: ugyanarra a bejelentésre a fiók szavazata marad');
select pg_temp.expect((select denials from public.reports where id = '00000000-0000-0000-0000-00000000aa04') = 0, 'összefésülés: a kieső szavazat a számlálóból is kiesik');
select pg_temp.expect((select count(*) from public.report_votes where report_id = '00000000-0000-0000-0000-00000000aa02') = 0, 'összefésülés: saját bejelentésre nem marad szavazat');
select pg_temp.expect(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000f3'), 'összefésülés: a névtelen felhasználó eltűnik');
select pg_temp.expect(not exists (select 1 from public.reports where user_id = '00000000-0000-0000-0000-0000000000f3') and not exists (select 1 from public.report_votes where user_id = '00000000-0000-0000-0000-0000000000f3'), 'összefésülés: semmi nem maradt a névtelen nevén');

-- azóta valódivá vált felhasználó adata nem kerülhet másik fiókhoz
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f4', true);
select set_config('app.merge_token2', public.account_merge_prepare()::text, true);
select pg_temp.as_admin();
update auth.users set is_anonymous = false where id = '00000000-0000-0000-0000-0000000000f4';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select pg_temp.expect((public.account_merge_claim(current_setting('app.merge_token2')::uuid) ->> 'merged')::boolean = false, 'összefésülés: valódivá vált felhasználó nem olvad be');
select pg_temp.as_admin();
select pg_temp.expect(exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000f4'), 'összefésülés: a valódivá vált felhasználó megmarad');

-- Fiók törlése: minden sor eltűnik, a névtelen közösségi cellák maradnak
insert into public.heat_cells (h3, h3_r8, lat, lon, count, avg_speed, hour, dow) values ('8a1e0000000ffff', '881e000000fffff', 47.5, 19.0, 1, 50, 8, 1);
insert into public.sections (id, country, road, direction, start_lat, start_lon, end_lat, end_lon, length_m, speed_limit_kmh, source, created_by)
  values ('test-account-1', 'HU', 'M1', 'teszt', 47.1, 19, 47.2, 19, 12000, 130, 'kozosseg', '00000000-0000-0000-0000-0000000000f1');
select set_config('app.heat_before', (select count(*)::text from public.heat_cells), true);
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.expect(not exists (select 1 from public.profiles where user_id = '00000000-0000-0000-0000-0000000000f1'), 'fiók törlése: a profil eltűnik');
select pg_temp.expect(not exists (select 1 from public.account_fields where user_id = '00000000-0000-0000-0000-0000000000f1'), 'fiók törlése: a szinkron-mezők eltűnnek');
select pg_temp.expect(not exists (select 1 from public.cloud_trips where user_id = '00000000-0000-0000-0000-0000000000f1'), 'fiók törlése: a felhős napló eltűnik');
select pg_temp.expect(not exists (select 1 from public.cloud_heat where user_id = '00000000-0000-0000-0000-0000000000f1'), 'fiók törlése: a felhős hőtérkép eltűnik');
select pg_temp.expect(not exists (select 1 from public.reports where user_id = '00000000-0000-0000-0000-0000000000f1'), 'fiók törlése: a bejelentések eltűnnek');
select pg_temp.expect(not exists (select 1 from public.report_votes where user_id = '00000000-0000-0000-0000-0000000000f1'), 'fiók törlése: a szavazatok eltűnnek');
select pg_temp.expect(not exists (select 1 from public.jam_samples where user_id = '00000000-0000-0000-0000-0000000000f1'), 'fiók törlése: a dugó-minták eltűnnek');
select pg_temp.expect((select created_by from public.sections where id = 'test-account-1') is null, 'fiók törlése: a közösségi szakasz gazdátlan marad');
select pg_temp.expect((select count(*)::text from public.heat_cells) = current_setting('app.heat_before'), 'fiók törlése: a névtelen közösségi cellák maradnak');
