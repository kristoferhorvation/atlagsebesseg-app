# Átlagsebesség-app

Kísérő app a Waze mellett: autópályán, átlagsebesség-mérő szakaszon (Tutor, Section Control)
a GPS alapján automatikusan elindul, nagy számmal mutatja a szakaszon eddig elért átlagsebességet,
és azt, hogy mennyivel kell lassítani, hogy a szakasz végén a határ alatt maradj.
Saját navigáció nincs.

## Szerkezet

```
packages/core   tiszta TypeScript, függőségek nélkül: szakasz-felismerés, átlag, állapotgép, kézi mód,
                tűrés, napállás
packages/data   szakasz-import (OSM Overpass, IT/AT/HU + hu-manual.json) → Section JSON  (output/: ODbL!),
                feltöltés Supabase-be, ideiglenes kapupár → szakasz (edge function logikája)
packages/app-logic      a web és a mobil közös logikája: mérés-munkamenet (háttérbe kerülés, kézi mód),
                szakasz-cache, bejelentések, Supabase-kliens, lightPreset, térkép-állapot
packages/design-tokens  színek, típus, térköz, mozgás – platformfüggetlen (DESIGN.md)
apps/web        PWA (Vite + React + mapbox-gl) – iPhone Safari, kezdőképernyő; szimulátor
apps/mobile     Expo (React Native, TS) + @rnmapbox/maps + supabase-js – dizájn nélküli váz
supabase/       migrációk (sections, reports, report_votes, app_config, ideiglenes kapuk + RLS),
                edge function (promote-temp-gates), SQL-tesztek
```

## Gyorsindítás

Node ≥ 20 és **npm ≥ 11** kell (az npm 10 egy ismert hibával – `Cannot read properties of null
(reading 'edgesOut')` – elszáll ezen a workspace-en; `npx npm@11 install` is jó).

```bash
npm install
npm test                 # core, data, app-logic, design-tokens, web unit-tesztek
npm run typecheck        # minden csomag (a mobilé is)
npm run dev --workspace apps/web        # PWA: http://localhost:5173  (szimulátor: /?sim)
npm run dev:https --workspace apps/web  # HTTPS a helyi hálózatra (iPhone) – apps/web/README.md
npm run test:edge        # edge function bundle + Deno-teszt
npm run db:test:local    # migrációk + SQL-tesztek helyi PostgreSQL-en (PGHOST, PGUSER)
```

Élő Supabase (a kulcsok a gyökér `.env`-ben, lásd `.env.example` – soha nem kerülnek a repóba):

```bash
npm run db:live          # supabase db push + az összes SQL-teszt élőben, ROLLBACK-kel
npm run import:sections  # OSM → packages/data/output (helyi gépen, internet kell)
npm run upload:sections  # → sections tábla (service role kulccsal, csak helyben)
npm run deploy:edge      # promote-temp-gates edge function
```

## Architektúra-döntések

- **Monorepo, npm workspaces.** A `core` forrásként (TS) van bekötve (`main: src/index.ts`), build
  lépés nélkül: Metro és Vitest is közvetlenül fordítja.
- **A `core` nem függ semmitől** (se React Native, se térkép, se Node API). Így egyszerűen
  tesztelhető, és később natív modulba (Live Activity / háttérfolyamat) is átvihető.
- **Útvonal menti mérés.** A GPS-fixeket a szakasz vonalára vetítjük (`Route.project`), a megtett
  út az útvonal menti távolság. Ezért alagút után az első jó fix pontosan megadja a valódi
  megtett utat (a kanyarokat is), a kiesés alatt pedig holtszámítással becslünk.
- **Szűrés:** belépéshez irányegyezés (≤ 45°) és ≤ 40 m útvonaltávolság kell (ellenirány és
  párhuzamos út kizárása); szakaszon > 60 m-es, ≥ 5 s-os eltérés = letérés. A pontatlan
  (> 35 m) és fizikailag lehetetlen (> 250 km/h-s ugrás) fixeket eldobjuk.
- **Belépés / kilépés ideje** a két szomszédos fix között interpolálva (1 Hz-es GPS mellett is
  < 0,3 s hiba).
- **„Szükséges sebesség”** = a hátralévő út / (hossz/határ − eltelt idő). Ha ez a határ 60%-a
  alá esne (130-as határnál 78 km/h – irreális lassítás), az eredmény `nem_lehetseges`
  (`minPracticalFraction`, konfigurálható).
- **Tűrés** (`toleranceKmh`, `limitWithToleranceKmh`): 5% vagy 5 km/h, a nagyobb – csak
  megjelenítésre; a szükséges sebesség és a figyelmeztetés mindig a szigorú határhoz számol.
- **Közös logika:** a platformfüggetlen app-logika (`packages/app-logic`) és a dizájn-tokenek
  (`packages/design-tokens`) külön csomag – a web és a mobil ugyanazt használja, a `core` függőségmentes marad.
- **Térkép-adapter:** az app csak a `MapAdapter` interfészt látja (`apps/mobile/src/map`, webe `apps/web/src/map`); a
  Mapbox-implementáció egyetlen helyen (`createMapAdapter`) cserélhető MapLibre-re.
- **Szavazás külön táblában** (`report_votes`): felhasználónként egy megerősítés/cáfolat, a
  számlálókat trigger tartja karban, így nem hamisíthatók.
- **Ideiglenes kapuk → közösségi szakasz:** a párosítás és a független megerősítések SQL-ben, a
  két kapu közti útvonal geometriája edge functionben (úthálózat kell hozzá) – indoklás:
  [`supabase/README.md`](supabase/README.md#miért-sql--edge-function).
- **Térkép-előbeállítás** (`lightPreset`): a rendszer világos/sötét módja és a helyi napállás
  (`core/sun.ts`) alapján; sötét módban sosem világos.

Az állapotgép: `nincs_szakasz → kozeledik → szakaszon → kesz | megszakadt`
(kész/megszakadt után 60 s-ig látszik az eredmény; egymást követő szakaszoknál kész után
azonnal `szakaszon` jöhet).

## Web deploy (Vercel) – élesben

**Élő app: https://atlagsebesseg.vercel.app** (szimulátor: https://atlagsebesseg.vercel.app/?sim)

Vercel-projekt: `atlagsebesseg` (CLI-ből deployolva, Git-integráció nélkül). A `vercel.json` a
gyökérben van (npm 11-es install, `apps/web` build, `apps/web/dist` kimenet, SPA-átirányítás,
`sw.js` cache nélkül, immutable assetek).

- **Környezeti változók** (Production, típus: config – mind nyilvános kliensérték):
  `VITE_MAPBOX_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Service role kulcsot SOHA.
  Új változó: `printf '%s' "$ERTEK" | npx vercel env add NEV production --type config --yes`.
- **Új deploy:** `npx vercel deploy --prod` a gyökérből (a `.vercel/` helyi kötés, nincs a repóban).
- Automatikus deploy commitonként: a GitHub-repó összekötése a Vercel-projekttel (még nincs).

## Mapbox

A web a `VITE_MAPBOX_TOKEN` nyilvános (pk.) tokent használja, Mapbox Standard stílussal.

**Döntés (2026-10-27, Kristof): a tokent nem korlátozzuk URL-re.** Ha később mégis kell:
Mapbox-fiók → Account → Tokens → a token → URL restrictions; lista: `https://atlagsebesseg.vercel.app`,
`http://localhost:5173`, `https://<helyi IP>:5173`.

A vállalt kockázat: korlátozás nélkül a token bárki által kimásolható a kliens-kódból, és más oldalon is használható
(a forgalmat a fiók fizeti). Korlátozás után a nem listázott domainen a térkép nem tölt be.

## Szakaszadatok – licenc

Az OSM-ből importált szakaszok az **OpenStreetMap** adatai: **© OpenStreetMap contributors**,
**ODbL 1.0** (https://opendatacommons.org/licenses/odbl/1-0/). A forrásmegjelölés kötelező az
appban és az adatfájlok mellett; részletek: [`packages/data/output/ATTRIBUTION.md`](packages/data/output/ATTRIBUTION.md).

## Csomagok

- [`packages/data/README.md`](packages/data/README.md) – az import futtatása
- [`supabase/README.md`](supabase/README.md) – séma, RLS, helyi teszt
- [`apps/web/README.md`](apps/web/README.md) – PWA, szimulátor, iPhone a helyi hálózaton
- [`apps/mobile/README.md`](apps/mobile/README.md) – Mapbox-token, dev build
- [`DESIGN.md`](DESIGN.md) – dizájn-elvek, tokenek, állapotok

## Szabályok

- Titok soha nem kerül a repóba (`.env` gitignore-ban; csak `.env.example`).
- Commitnál explicit útvonalak, `git add -A` nem.
