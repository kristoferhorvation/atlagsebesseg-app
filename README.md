# Átlagsebesség-app

Kísérő app a Waze mellett: autópályán, átlagsebesség-mérő szakaszon (Tutor, Section Control)
a GPS alapján automatikusan elindul, nagy számmal mutatja a szakaszon eddig elért átlagsebességet,
és azt, hogy mennyivel kell lassítani, hogy a szakasz végén a határ alatt maradj.
Saját navigáció nincs.

## Szerkezet

```
packages/core   tiszta TypeScript, függőségek nélkül: szakasz-felismerés, átlag, állapotgép, kézi mód
packages/data   szakasz-import (OSM Overpass) → Section JSON  (output/: ODbL!)
apps/mobile     Expo (React Native, TS) + @rnmapbox/maps – egyelőre dizájn nélküli váz
supabase/       migrációk (sections, reports, report_votes + RLS)
```

## Gyorsindítás

Node ≥ 20 és **npm ≥ 11** kell (az npm 10 egy ismert hibával – `Cannot read properties of null
(reading 'edgesOut')` – elszáll ezen a workspace-en; `npx npm@11 install` is jó).

```bash
npm install
npm test                 # core + data unit-tesztek
npm run typecheck        # mindhárom csomag
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
- **Térkép-adapter:** az app csak a `MapAdapter` interfészt látja (`apps/mobile/src/map`); a
  Mapbox-implementáció egyetlen helyen (`createMapAdapter`) cserélhető MapLibre-re.
- **Szavazás külön táblában** (`report_votes`): felhasználónként egy megerősítés/cáfolat, a
  számlálókat trigger tartja karban, így nem hamisíthatók.

Az állapotgép: `nincs_szakasz → kozeledik → szakaszon → kesz | megszakadt`
(kész/megszakadt után 60 s-ig látszik az eredmény; egymást követő szakaszoknál kész után
azonnal `szakaszon` jöhet).

## Szakaszadatok – licenc

Az OSM-ből importált szakaszok az **OpenStreetMap** adatai: **© OpenStreetMap contributors**,
**ODbL 1.0** (https://opendatacommons.org/licenses/odbl/1-0/). A forrásmegjelölés kötelező az
appban és az adatfájlok mellett; részletek: [`packages/data/output/ATTRIBUTION.md`](packages/data/output/ATTRIBUTION.md).

## Csomagok

- [`packages/data/README.md`](packages/data/README.md) – az import futtatása
- [`supabase/README.md`](supabase/README.md) – séma, RLS, helyi teszt
- [`apps/mobile/README.md`](apps/mobile/README.md) – Mapbox-token, dev build

## Szabályok

- Titok soha nem kerül a repóba (`.env` gitignore-ban; csak `.env.example`).
- Commitnál explicit útvonalak, `git add -A` nem.
