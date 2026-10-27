# Supabase-séma

A Supabase CLI fejlesztői függőség (`npx supabase …`). Élő projekt bekötése:

```bash
cp .env.example .env            # SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY …
npm run db:live                 # = supabase/tests/run-live.sh: db push + az összes teszt élőben
```

A `run-live.sh` a `supabase db push --db-url "$SUPABASE_DB_URL"` paranccsal alkalmazza a
hiányzó migrációkat, majd a tesztfájlokat tranzakcióban, `ROLLBACK`-kel futtatja – az élő
adatokat nem módosítja. **Az anonim bejelentkezést a Supabase-dashboardon be kell kapcsolni**
(Authentication → Sign In / Providers → Anonymous), a helyi `config.toml`-ban be van kapcsolva.

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
- **app_config** – konfiguráció (pl. `temp_gate_min_confirmations` = 3); csak service_role írja.
- **temp_gate_sections** – melyik kapupárból melyik szakasz lett (vagy miért nem).
- `sections.expires_at` – a kapupárból létrejött szakaszok lejárata; a lejártakat az RLS elrejti.
- `sections_in_bbox(south, west, north, east)` – az app ezzel kéri le a környék szakaszait.

## Ideiglenes kapuk (`ideiglenes_kapu`)

Egy bejelentés = egy kapu: hely + irány (`heading_deg`) + `gate_kind` (`kezdo` | `zaro`),
opcionálisan `road` és `speed_limit_kmh`. Lejárat 6 óra, minden megerősítés +2 óra.

Kész kapupár (`temp_gate_ready_pairs()`):

- egy kezdő és egy záró kapu, mindkettő érvényes;
- azonos út (ha mindkettőn meg van adva; kis/nagybetű és szóköz nem számít);
- azonos irány (≤ 45°), és a zárókapu a kezdőkapu *előtt* van a haladási irányban (≤ 60°);
- távolság 300 m – 30 km;
- legalább **N** (alapból 3, `app_config.temp_gate_min_confirmations`) **független megerősítés**:
  a két kapu bármelyikét megerősítő *különböző* felhasználók, a két bejelentőt nem számítva;
- egyik kapun sem több a cáfolat, mint a megerősítés; egy kapu csak egy szakaszhoz tartozhat.

Kezdőkapunként a legközelebbi megfelelő zárókapu a pár. A belőle létrejövő szakasz
`kozosseg` forrású, `verified = false`, a határ a bejelentett (két kapu közül a szigorúbb),
ennek hiányában az úthálózat `maxspeed`-je; 30 nap után lejár, ha egyik kapuját sem erősítik meg újra
(minden megerősítés +30 napra tolja).

### Miért SQL + edge function?

- A **párosítás és a megerősítések számolása SQL-ben** van: tranzakcionálisan, az RLS mellett
  fut, nem kerülhető meg a kliensből (a számlálók triggerből jönnek), és a teljes logika sima
  PostgreSQL-en tesztelhető (`tests/temp_gate_test.sql`, 26 ellenőrzés).
- A **geometria az edge functionben** (`functions/promote-temp-gates`) készül, mert a két kapu
  közötti útvonalhoz úthálózat kell: OSM-utak (Overpass) + a `data` csomag irányhelyes
  útvonalkeresése (`routeBetween`). Ez SQL-ben csak pgRouting + teljes OSM-import mellett menne,
  ami ehhez a projektmérethez aránytalan. Az edge function a kész párokra kiszámolja az útvonalat,
  és a `temp_gate_create_section()` függvénnyel (csak service_role) hozza létre a szakaszt; ez a
  függvény a beszúrás előtt újra ellenőrzi, hogy a pár kész-e, így a döntés mindig az SQL-é.
- Ha nincs útvonal, a `temp_gate_mark_failed()` naplózza, és 1 óráig nem próbálja újra.

## RLS

| tábla | olvasás | írás | törlés |
|---|---|---|---|
| sections | mindenki (le nem járt) | bejelentkezve, csak `kozosseg` + `verified=false`, módosítás a sajátra | csak service_role |
| reports | mindenki | bejelentkezve, saját névre; módosítás csak a sajátot (számlálót nem) | csak a sajátot |
| report_votes | mindenki | bejelentkezve, saját névre, nem a saját bejelentésre | a saját szavazatot |

Az OSM/hivatalos szakaszokat az import a `service_role` kulccsal tölti (megkerüli az RLS-t);
ez a kulcs soha nem kerül az appba vagy a repóba.

## Helyi teszt (Supabase nélkül)

`tests/stub_supabase.sql` utánozza a Supabase szerepköreit (`anon`, `authenticated`) és az
`auth.uid()` függvényt. Tesztek: `tests/rls_test.sql` (18 ellenőrzés) és
`tests/temp_gate_test.sql` (26 ellenőrzés), mindkettő tranzakcióban, ROLLBACK-kel.

A tesztek helyben és élőben is futnak: az `auth.users`-be oszlopnévvel (`(id)`) szúrnak be (az élő
táblában az első oszlop az `instance_id`), a felhasználót a `pg_temp.as_user()` szimulálja
(`request.jwt.claim.sub` és `request.jwt.claims` is, ahogy az élő `auth.uid()` olvassa), és minden
ellenőrzés a teszt saját soraira szűr – élőben a valódi szakaszok és bejelentések nem zavarnak.

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run-local.sh
```

## Edge function: `promote-temp-gates`

A kész kapupárokból szakaszt csináló függvény (`functions/promote-temp-gates/index.ts`). A
logika a `packages/data` csomagban van (`src/promote.ts`, `src/edge.ts`); a Deno nem oldja fel a
workspace-csomagokat, ezért deploy előtt egyetlen fájlba csomagoljuk (`promote.bundle.js`, generált,
gitignore-ban):

```bash
npm run test:edge      # bundle + Deno-teszt (hamis Supabase/Overpass)
npm run deploy:edge    # bundle + supabase functions deploy promote-temp-gates
```

Csak `Authorization: Bearer <CRON_SECRET>` fejléccel hívható (a `CRON_SECRET` a függvény secretje:
`supabase secrets set CRON_SECRET=…`; a platform JWT-ellenőrzése ki van kapcsolva, `verify_jwt = false`).
A függvény a Supabase-hez a platform által injektált `SUPABASE_SERVICE_ROLE_KEY`-jel fér hozzá.

Ütemezés (a projekten egyszer beállítva): `pg_cron` job `promote-temp-gates`, `*/10 * * * *`, ami a
`pg_net` `net.http_post`-jával hívja a függvény URL-jét. A titok a Vaultban van
(`vault.decrypted_secrets`, név: `promote_temp_gates_cron_secret`), nem a job szövegében.

## Szakaszok feltöltése

```bash
npm run import:sections          # OSM → packages/data/output/*.json (helyi gépen)
npm run upload:sections          # → sections tábla, upsert id szerint (service role, gyökér .env)
npm run upload:sections -- --country IT --dry-run
```
