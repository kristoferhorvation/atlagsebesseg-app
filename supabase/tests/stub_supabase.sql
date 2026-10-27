-- CSAK HELYI TESZTHEZ: a Supabase által biztosított szerepkörök és auth séma minimális utánzata,
-- hogy a migráció sima PostgreSQL-en is kipróbálható legyen. Élő Supabase-projekten NE futtasd.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
-- Az élő auth.users-hez hasonlóan az id nem az első oszlop (a tesztek oszlopnévvel szúrnak be).
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  is_anonymous boolean not null default false
);
-- Mint a Supabase auth.uid(): a régi (claim.sub) és az új (claims JSON) beállítást is olvassa.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
