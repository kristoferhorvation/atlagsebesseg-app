# Supabase-séma

Csak migráció – élő projekt nincs létrehozva. Élesítés: `supabase link --project-ref <ref>` majd
`supabase db push` (a Supabase CLI-vel, a saját projekteden).

## Táblák

- **sections** – a `Section` típus mezői (`start_lat/lon`, `end_lat/lon`, `length_m`,
  `speed_limit_kmh`, `source` = `osm | hivatalos | kozosseg`, `verified`, `geometry` jsonb
  `[[lon, lat], …]`), plusz `created_by`, időbélyegek.
- **reports** – közösségi bejelentés: `type`, `lat`, `lon`, `heading_deg` (irány), `user_id`
  (ki), `created_at` (mikor), `confirmations`, `denials`, `expires_at` (alapból +2 óra; minden
  megerősítés legalább +1 órára hosszabbít).
- **report_votes** – megerősítés/cáfolat, felhasználónként és bejelentésenként egy; a
  számlálókat trigger tartja karban.
- **active_reports** – nézet a le nem járt bejelentésekre.

## RLS

| tábla | olvasás | írás | törlés |
|---|---|---|---|
| sections | mindenki | bejelentkezve, csak `kozosseg` + `verified=false`, módosítás a sajátra | csak service_role |
| reports | mindenki | bejelentkezve, saját névre; módosítás csak a sajátot (számlálót nem) | csak a sajátot |
| report_votes | mindenki | bejelentkezve, saját névre, nem a saját bejelentésre | a saját szavazatot |

Az OSM/hivatalos szakaszokat az import a `service_role` kulccsal tölti (megkerüli az RLS-t);
ez a kulcs soha nem kerül az appba vagy a repóba.

## Helyi teszt (Supabase nélkül)

`tests/stub_supabase.sql` utánozza a Supabase szerepköreit (`anon`, `authenticated`) és az
`auth.uid()` függvényt; `tests/rls_test.sql` 18 ellenőrzést futtat.

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run-local.sh
```
