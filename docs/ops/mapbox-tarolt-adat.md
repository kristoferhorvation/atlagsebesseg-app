# Tárolt Mapbox API-eredmények – leltár (AW25b, 2026-11-06)

Mapbox-feltételek: a Directions-, Map Matching- és Geocoding / Search Box-eredmény tartósan nem tárolható (a Search Box ideiglenesen, a futás idejére igen). Ez a lista a repóban és a készüléken tárolt adatot nézi végig.

## Cserélve (AW25b)

| Hol | Mi volt | Mi lett |
|---|---|---|
| `packages/app-logic/src/fixtures/heat-seed-routes.json` (web `?heatSeed`, iOS `-heatSeed YES`) | Mapbox Directions-geometria (10 budapesti út) | OSRM-útvonal az OSM-hálózaton (`router.project-osrm.org`, © OpenStreetMap contributors, ODbL); felvétel: `npx tsx apps/web/scripts/record-heat-seed.mts`, token nélkül |
| Mentett helyek és legutóbbi úti célok (web `nav:saved:v1`, `nav:recents:v1`, iOS ugyanígy, fiók-szinkron `place.*`, `recents`) | az azonosító a Mapbox `mapbox_id` volt | az azonosító a koordináta-kulcs (`placeKey`, 5 tizedes); a régi elem betöltéskor átíródik, a fiók-szinkron a régi mezőt törlési jelölővel zárja, a duplikátum egyszer marad |
| Utak naplója (`Trip.destination`: web IndexedDB `trips`, iOS SQLite `trips`, `cloud_trips.record`) | a navigáció céljának Mapbox-neve | a saját címke vagy `@<koordináta-kulcs>`; a cím megjelenítéskor a névtárból (a futás alatt látott / újra lekért név), különben a koordináta; a régi, névvel tárolt cél betöltéskor az út végpontjának kulcsára íródik (helyben vissza is íródik) |

## Megmarad – nem tárolt API-eredmény

| Hol | Miért rendben |
|---|---|
| `packages/app-logic/src/fixtures/track-budapest.json`, `gps-trace-1hz.json` | OSM nyilvános GPS-nyomok; a Map Matching-válaszok az AW25-ben kikerültek |
| `packages/app-logic/src/fixtures/track-budapest-roads.json` | OSM (Overpass) |
| `packages/data/**` (szakaszok, kamerák, határok) | OSM, hivatalos listák, Natural Earth |
| iOS App Group `live-map-0.png` / `live-map-1.png` | a Live Activity térképképe (Static Images API): két, egymást felülíró megjelenítési puffer – a widget-folyamat maga nem tud hálózatról kérni; nem gyűjt, nem archivál |
| Memóriabeli névtár (`placeNames`), `RouteFetcher` útvonalai | csak a futás idejére (ideiglenes) |
| `docs/screenshots/**`, `docs/marketing/**` | az app képernyőképei Mapbox-attribúcióval, nem API-válasz |

## Nyitott – Kristof döntése kell

| Hol | Mi | Miért nem cseréltük éjjel | Javaslat |
|---|---|---|---|
| `packages/app-logic/src/navigation/fixtures/budapest-gyor.directions.json` (251 KB) és a belőle generált `apps/ios/Atlagsebesseg/Resources/Sim/navsim-budapest-gyor.json`, `navsim-traffic.json`, a webes `?navsim` | teljes Mapbox Directions-válasz (2026-10-29, Budapest → Győr, két útvonal), a 86 + 86 páros navigációs teszt és a navigációs szimulátor alapja | a csere minden navigációs teszt elvárását (távok, lépésszám, „Kijárat 67”, bemondások, congestion-adat) és a nav-shots / paritás-képeket átírja; felügyelet nélkül nem biztonságos | saját, kézzel épített Directions-alakú fixtúra az OSRM-válaszból (OSM-geometria + saját bemondás- / banner- / congestion-mezők), külön körben, a tesztek elvárásainak tételes átírásával (becslés: 1 kör) |
| `cloud_trips.record.destination` a szerveren (a régi, névvel feltöltött utak) | a felhős napló régi sorai Mapbox-nevet tartalmazhatnak | adat-módosítás az élő táblán – ebben a körben csak additív migráció engedélyezett | egyszeri `update cloud_trips set record = jsonb_set(...)` a végpont koordinátájával, engedéllyel |
