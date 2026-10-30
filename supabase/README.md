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
  AW18: új típusok `dugo` (lassan halad) és `beallt` (áll).
- **jam_samples** (AW18) – közösségi dugó-adat: `kind` (`erzekelt | bejelentett | oldott`), a mért szakasz végpontja
  (`lat`, `lon`), `heading_deg`, `avg_kmh`, `length_m`, `user_id`, `created_at` (a szerveré, trigger). Az app 15 percnél
  frissebb, azonos irányú, más felhasználótól származó mintával írja felül az érintett szakasz idejét az ETA-ban.
- **active_jams** – nézet a 15 percnél frissebb mintákra (explicit oszloplistával).
- **report_votes** – megerősítés/cáfolat, felhasználónként és bejelentésenként egy; a
  számlálókat trigger tartja karban.
- **active_reports** – nézet a le nem járt bejelentésekre, **explicit oszloplistával** (A5): a
  `reports` új oszlopát ide is fel kell venni (a `select *` a létrehozáskor rögzül).
- **app_config** – konfiguráció (pl. `temp_gate_min_confirmations` = 3); csak service_role írja.
- **temp_gate_sections** – melyik kapupárból melyik szakasz lett (vagy miért nem).
- `sections.expires_at` – a kapupárból létrejött szakaszok lejárata; a lejártakat az RLS elrejti.
- `sections_in_bbox(south, west, north, east)` – az app ezzel kéri le a környék szakaszait.
- **cameras** (A7) – fix kamerák: `type` (`speed | red_light | complex | section_gate`), `lat`, `lng`,
  `heading` (opcionális), `road`, `speed_limit_kmh` (opcionális), `source`, `source_url`, `source_date`,
  `verified`. Kliensről csak olvasható; az import (`npm run import:cameras -- --upload`) tölti
  service role-lal. Lekérés: `cameras_in_bbox(south, west, north, east)`.
- **planned_checks** (A7) – a rendőrség által előre megnevezett mérési helyszínek: `county`,
  `settlement`, `road_ref`, `description` (a rendőrségi sor szó szerint), `geometry` (GeoJSON
  `LineString`, vagy `MultiLineString`, ha a hely több vonal – osztott pálya, kereszteződés),
  befoglaló téglalap (`min_lat` … `max_lng`), `speed_limit_kmh`, `limit_source` (`osm | kresz_default`),
  `valid_from`, `valid_to` (a közzétett hét vége), `time_window` (ha a forrás órát is ad), `source_url`,
  `fetched_at`. Kliensről csak olvasható, **a lejártat az RLS elrejti**; lekérés:
  `planned_checks_in_bbox(...)` (a vonal befoglalója metszi a téglalapot). A lejárt sorokat a
  következő futás törli.
- **planned_check_runs** (A7) – a `fetch-planned-checks` futásnaplója (ok, összegzés megyénként, hiba);
  csak service_role.

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
| jam_samples | mindenki | bejelentkezve, saját névre; módosítás nincs | csak a sajátot |

Az OSM/hivatalos szakaszokat az import a `service_role` kulccsal tölti (megkerüli az RLS-t);
ez a kulcs soha nem kerül az appba vagy a repóba.

## Helyi teszt (Supabase nélkül)

`tests/stub_supabase.sql` utánozza a Supabase szerepköreit (`anon`, `authenticated`) és az
`auth.uid()` függvényt. Tesztek: `tests/rls_test.sql` (18 ellenőrzés),
`tests/temp_gate_test.sql` (26 ellenőrzés) és `tests/cameras_test.sql` (17 ellenőrzés, A7), mindhárom tranzakcióban, ROLLBACK-kel.

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

## Edge function: `fetch-planned-checks` (A7)

A police.hu közlekedésrendészeti hírei közül azokat dolgozza fel, amelyek előre megnevezett
mérési helyszíneket tartalmaznak (cikkszövegben vagy PDF-mellékletben), és a `planned_checks`
táblába írja az OSM-re illesztve. **A rendőrség 2018 óta nem közöl heti, megyei mérési tervet**;
helyszínt ma csak az évi Speedmarathon (megyénként PDF) és egy-egy megyei akció ad. A heti
ROADPOL-bejelentés helyszín nélküli → 0 sor, ez a normál eset.

- Forrás: `https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet`
  (gépi forrás – RSS/JSON – a helyszínekhez nincs; a megyei RSS-ek 10 hírt adnak, a lista mind a 20 szervet lefedi).
- Jelölt: az utolsó 21 nap híre, amelynek címe/bevezetője sebességmérésre / helyszínekre utal.
- Időszak a szövegből; ha nincs dátum, a cikk kimarad. Lejárat: az utolsó nap hetének vasárnapja 23:59 (budapesti idő).
- Helymeghatározás (`packages/data/src/planned/`): település + útszám → az út a település
  közigazgatási határán belül (OSM admin_level=8, Budapesten a kerület, 9); település + utca → az
  utca a településen; kereszteződés → mindkét ág a csomópont 300 m-es körzetében; útszám + km
  település nélkül → a km-kövek (`highway=milestone`) között. Településrész („Ajka-Bakonygyepes”) →
  a fő település határán belül. Utcanév: szigorú egyezés („Petőfi S.” = „Petőfi Sándor”); ha nincs,
  egy elhagyott szó („Kossuth utca” = „Kossuth Lajos utca”), majd más utcatípus („Fő utca” = „Fő út”)
  – az utóbbi kettő csak akkor, ha a településen pontosan egy ilyen nevű utca van. Megyénként egy Overpass-lekérés
  (határok geometriával + a kért utak), a vágás helyben. Ami nem illeszthető, kimarad, és a
  válaszban / a naplóban megyénként, a sor szó szerinti szövegével és okkal szerepel.
- **Zóna (A7c)**: ha a sor csak települést ad (a név, „belterülete”, „(álló-)mozgó ellenőrzés”; út, utca,
  házszám nélkül), a sor zóna-típusú: `geometry` = a település OSM-közigazgatási határa
  (`Polygon`/`MultiPolygon`, 25 m-re egyszerűsítve), `speed_limit_kmh` formális 50 / `kresz_default`
  (a sáv nem mutatja). Település + olyan hely, amit nem értünk („Szeged Kossuth sgt.”), **nem** zóna –
  pontos hely helyett nem állítunk egész várost. Az app halvány sárga kitöltéssel rajzolja, a
  településen belül a felső sáv: „Rendőrségi mérés {település} területén · {dátum} · forrás: {forrás}”,
  csak aktuális dátumra. Azonos azonosítójú (kétszer szereplő) sor egyszer kerül a kötegbe.
- Sebességhatár: a vonal menti OSM `maxspeed` (több érték → hossz szerint a leggyakoribb); ha
  nincs, KRESZ-alapérték (autópálya 130, autóút 110, lakott 50, lakott kívül 90) → `kresz_default`,
  az app „max ~90”-ként mutatja.
- Hiba (500, a naplóban `ok = false`): a police.hu nem érhető el, a hírlista 0 hírt ad (szerkezet-
  változás), vagy egy helyszín-mellékletből 0 sor jön. Nincs csendes üres eredmény.
- Időkeret: 100 s után nem indít új Overpass-lekérést (`remaining` a válaszban); nagy listát
  (Speedmarathon, ~1100 sor) helyben érdemes futtatni: `npm run planned:fetch -- --upload`
  (ugyanaz a kód, időkorlát nélkül).
- Kézi futtatás egy cikkre: `POST {"articleUrls": ["https://www.police.hu/…"]}`.
- A police.hu a Supabase-szerverről (eu-west-1, Írország) elérhető (2026-10-28-án mérve: 20 hír,
  a PDF-ek `npm:unpdf`-fel olvashatók). Ha ez megváltozna, tartalék: ugyanaz a szkript helyi
  ütemezett feladatként (`launchd`) vagy Vercel cronból.

```bash
npm run test:edge      # mindkét bundle + Deno-teszt
npm run deploy:edge    # mindkét függvény
```

Ütemezés (`pg_cron`, 2026-10-28-án beállítva): job `fetch-planned-checks`, `0 5 * * 1,4` – hétfőn és
csütörtökön 05:00 UTC = **06:00 budapesti téli idő** (nyári időben 07:00; a pg_cron UTC-ben fut).
Ugyanaz a CRON_SECRET-minta, mint a `promote-temp-gates`-nél (a titok a Vaultban, a függvényben
`CRON_SECRET` secret):

```sql
select cron.schedule('fetch-planned-checks', '0 5 * * 1,4', $$select net.http_post(
  url := 'https://<projekt>.supabase.co/functions/v1/fetch-planned-checks',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
    (select decrypted_secret from vault.decrypted_secrets where name='promote_temp_gates_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 140000
) as request_id$$);
-- ellenőrzés: select * from planned_check_runs order by id desc limit 5;
```

## Szakaszok feltöltése

```bash
npm run import:sections          # OSM → packages/data/output/*.json (helyi gépen)
npm run upload:sections          # → sections tábla, upsert id szerint (service role, gyökér .env)
npm run upload:sections -- --country IT --dry-run
```
