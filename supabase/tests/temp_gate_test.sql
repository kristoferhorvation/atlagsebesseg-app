-- Ideiglenes kapuk → automatikus közösségi szakasz (SQL-oldal) tesztje.
-- Futtatás: tests/run-local.sh vagy tests/run-live.sh (tranzakcióban, a végén ROLLBACK).
\set QUIET on
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000000' || x)::uuid
  from unnest(array['a1','b1','c1','d1','e1','f1']) x on conflict do nothing;

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
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || u, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated')::text, true);
end $$;
-- Csak a teszt saját kapuiból képzett párok számítanak (élőben más, valódi párok is lehetnek).
create function pg_temp.ready() returns bigint language sql as $$
  select count(*) from public.temp_gate_ready_pairs() where start_report_id::text like 'aaaaaaaa-%'
$$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- 46.0 N, 11.0 E környékén; 0,09° szélesség ≈ 10 km észak felé
set role authenticated;
select pg_temp.as_user('a1');
insert into public.reports (id, type, gate_kind, lat, lon, heading_deg, road, speed_limit_kmh)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'ideiglenes_kapu', 'kezdo', 46.0, 11.0, 0, 'A22', 110);
select pg_temp.expect_error($$insert into public.reports (type, gate_kind, lat, lon) values ('ideiglenes_kapu', 'kezdo', 46, 11)$$, 'kapu irány nélkül nem jelenthető');
select pg_temp.expect_error($$insert into public.reports (type, lat, lon, heading_deg) values ('ideiglenes_kapu', 46, 11, 0)$$, 'kapu kezdő/záró jelző nélkül nem jelenthető');
select pg_temp.as_user('b1');
insert into public.reports (id, type, gate_kind, lat, lon, heading_deg, road)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'ideiglenes_kapu', 'zaro', 46.09, 11.0, 5, ' a22 ');
-- rossz kapuk: ellenirány, a kezdőkapu mögött, másik út, túl közel
insert into public.reports (id, type, gate_kind, lat, lon, heading_deg, road) values
  ('aaaaaaaa-0000-0000-0000-000000000003', 'ideiglenes_kapu', 'zaro', 46.05, 11.0, 180, 'A22'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'ideiglenes_kapu', 'zaro', 45.95, 11.0, 0, 'A22'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'ideiglenes_kapu', 'zaro', 46.06, 11.0, 0, 'SS12'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'ideiglenes_kapu', 'zaro', 46.001, 11.0, 0, 'A22');
reset role;

select pg_temp.expect((select abs(extract(epoch from (expires_at - created_at)) - 6 * 3600) < 5
                         from public.reports where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'kapu lejárata 6 óra');

-- megerősítések
set role authenticated;
select pg_temp.as_user('b1');  -- a zárókapu bejelentője: nem független
insert into public.report_votes (report_id, confirm) values ('aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.as_user('c1');
insert into public.report_votes (report_id, confirm) values ('aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.as_user('d1');
insert into public.report_votes (report_id, confirm) values ('aaaaaaaa-0000-0000-0000-000000000002', true);
select pg_temp.as_user('c1');  -- ugyanaz a felhasználó a másik kapun: nem számít külön
insert into public.report_votes (report_id, confirm) values ('aaaaaaaa-0000-0000-0000-000000000002', true);
select pg_temp.expect_error($$select public.temp_gate_ready_pairs()$$, 'authenticated nem hívhatja a párosítást');
select pg_temp.expect_error($$select public.temp_gate_create_section('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', '[[11,46],[11,46.09]]', 10000)$$, 'authenticated nem hozhat létre szakaszt kapukból');
reset role;

set role service_role;
select pg_temp.expect(pg_temp.ready() = 0, '2 független megerősítés még kevés (a bejelentő és az ismétlés nem számít)');
reset role;
select pg_temp.expect((select abs(extract(epoch from (expires_at - created_at)) - 10 * 3600) < 5
                         from public.reports where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'megerősítésenként +2 óra (két megerősítés: 6 + 2 + 2 = 10 óra)');

set role authenticated;
select pg_temp.as_user('e1');
insert into public.report_votes (report_id, confirm) values ('aaaaaaaa-0000-0000-0000-000000000002', true);
-- a rossz zárókapukat is megerősítik – attól még nem párosíthatók
insert into public.report_votes (report_id, confirm)
select ('aaaaaaaa-0000-0000-0000-00000000000' || x)::uuid, true from unnest(array['3','4','5','6']) x;
select pg_temp.as_user('d1');
insert into public.report_votes (report_id, confirm)
select ('aaaaaaaa-0000-0000-0000-00000000000' || x)::uuid, true from unnest(array['3','4','5','6']) x;
reset role;

set role service_role;
select pg_temp.expect(pg_temp.ready() = 1, '3 független megerősítés: pontosan egy kész pár');
select pg_temp.expect((select end_report_id = 'aaaaaaaa-0000-0000-0000-000000000002' and independent_confirms = 3
                         and distance_m between 9900 and 10100 from public.temp_gate_ready_pairs()
                         where start_report_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
                      'a pár a helyes zárókapu (nem az ellenirányú, a mögötte lévő, a másik úton lévő vagy a túl közeli)');
reset role;

update public.app_config set value = '4' where key = 'temp_gate_min_confirmations';
set role service_role;
select pg_temp.expect(pg_temp.ready() = 0, 'N konfigurálható: N = 4 mellett nincs kész pár');
reset role;
update public.app_config set value = '3' where key = 'temp_gate_min_confirmations';

-- cáfolat: ha egy kapun több a cáfolat, mint a megerősítés, a pár nem kész
set role authenticated;
select pg_temp.as_user('f1');
insert into public.report_votes (report_id, confirm) values ('aaaaaaaa-0000-0000-0000-000000000002', false);
reset role;
set role service_role;
select pg_temp.expect(pg_temp.ready() = 1, '1 cáfolat 3 megerősítés mellett nem akadály');
reset role;

-- sikertelen geometria: 1 óráig nem próbálja újra
set role service_role;
select public.temp_gate_mark_failed('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'teszt: nincs útvonal');
select pg_temp.expect(pg_temp.ready() = 0, 'sikertelen kísérlet után 1 óráig nem kész');
reset role;
update public.temp_gate_sections set created_at = now() - interval '2 hours'
  where section_id is null and start_report_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- szakasz létrehozása (az edge function ezt hívja service_role-lal)
set role service_role;
select pg_temp.expect(pg_temp.ready() = 1, '1 óra után újra kész');
select pg_temp.expect_error($$select public.temp_gate_create_section('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', '[[11,46],[11,46.05]]', 5000)$$, 'nem kész párból nem hoz létre szakaszt');
select pg_temp.expect(
  public.temp_gate_create_section('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
                                  '[[11,46],[11.001,46.045],[11,46.09]]', 10012, 'A22', 130::smallint, 'it')
  = 'kozosseg-tg-aaaaaaaa0000', 'szakasz létrejött');
select pg_temp.expect(pg_temp.ready() = 0, 'a felhasznált kapuk nem párosíthatók újra');
select pg_temp.expect_error($$select public.temp_gate_create_section('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', '[[11,46],[11,46.09]]', 10000)$$, 'ugyanabból a párból másodszor nem');
reset role;

select pg_temp.expect((select source = 'kozosseg' and not verified and speed_limit_kmh = 110 and country = 'IT'
                              and road = 'A22' and length_m = 10012 and jsonb_array_length(geometry) = 3
                              and abs(extract(epoch from (expires_at - now())) - 30 * 86400) < 60
                         from public.sections where id = 'kozosseg-tg-aaaaaaaa0000'),
                      'közösségi, nem ellenőrzött, a bejelentett (szigorúbb) határral, 30 napos lejárattal');

set role anon;
select pg_temp.expect((select count(*) from public.sections_in_bbox(45.9, 10.9, 46.2, 11.1) where id = 'kozosseg-tg-aaaaaaaa0000') = 1, 'anon látja a bbox-ban');
select pg_temp.expect((select count(*) from public.sections_in_bbox(47, 12, 48, 13) where id = 'kozosseg-tg-aaaaaaaa0000') = 0, 'a bbox-on kívül nem');
reset role;

-- lejárat és meghosszabbítás
update public.sections set expires_at = now() - interval '1 minute' where id = 'kozosseg-tg-aaaaaaaa0000';
set role anon;
select pg_temp.expect((select count(*) from public.sections where id = 'kozosseg-tg-aaaaaaaa0000') = 0, 'lejárt szakasz nem látszik');
reset role;
set role authenticated;
select pg_temp.as_user('f1');
update public.report_votes set confirm = true where report_id = 'aaaaaaaa-0000-0000-0000-000000000002';
reset role;
select pg_temp.expect((select abs(extract(epoch from (expires_at - now())) - 30 * 86400) < 60
                         from public.sections where id = 'kozosseg-tg-aaaaaaaa0000'), 'új megerősítés +30 napra hosszabbítja a szakaszt');
set role anon;
select pg_temp.expect((select count(*) from public.sections where id = 'kozosseg-tg-aaaaaaaa0000') = 1, 'meghosszabbítva újra látszik');
select pg_temp.expect_error($$update public.app_config set value = '1' where key = 'temp_gate_min_confirmations'$$, 'anon nem írja a konfigot');
reset role;
set role authenticated;
select pg_temp.as_user('b1');
select pg_temp.expect_error($$insert into public.temp_gate_sections (start_report_id, end_report_id, error) values ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000004', 'x')$$, 'authenticated nem írja a kapu-szakasz kapcsolatot');
update public.reports set expires_at = now() + interval '100 days' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
reset role;
select pg_temp.expect((select expires_at < now() + interval '1 day' from public.reports where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'a bejelentő nem hosszabbíthatja a saját kapuját');
\echo 'Ideiglenes kapu teszt: minden ellenőrzés zöld'
