-- AOS17: a Térképhiba alkategóriája. Futtatás: tests/run-local.sh vagy tests/run-live.sh (tranzakcióban, a végén ROLLBACK).
\set QUIET on
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a9') on conflict do nothing;

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

do $$
declare k text;
begin
  foreach k in array array['szakaszhatar', 'sebesseghatar', 'nem_letezik', 'hianyzo', 'kamera', 'egyeb'] loop
    insert into public.reports (type, lat, lon, user_id, subtype) values ('szakasz_hiba', 47.5, 19.0, '00000000-0000-0000-0000-0000000000a9', k);
  end loop;
end $$;
select pg_temp.expect((select count(*) from public.reports where user_id = '00000000-0000-0000-0000-0000000000a9' and subtype is not null) = 6, 'mind a hat alkategória beírható');
select pg_temp.expect((select count(*) from public.active_reports where user_id = '00000000-0000-0000-0000-0000000000a9' and subtype = 'kamera') = 1, 'az active_reports nézet is adja az oszlopot');
insert into public.reports (type, lat, lon, user_id) values ('szakasz_hiba', 47.5, 19.0, '00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(true, 'alkategória nélkül is beírható (régi kliens)');
select pg_temp.expect_error($q$insert into public.reports (type, lat, lon, user_id, subtype) values ('szakasz_hiba', 47.5, 19.0, '00000000-0000-0000-0000-0000000000a9', 'x')$q$, 'ismeretlen alkategória tiltott');
select pg_temp.expect_error($q$insert into public.reports (type, lat, lon, user_id, subtype) values ('baleset', 47.5, 19.0, '00000000-0000-0000-0000-0000000000a9', 'kamera')$q$, 'más típus nem kaphat alkategóriát');
