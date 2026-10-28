# Átlagsebesség-app – Claude Code útmutató

## Mi ez
Szekciókontroll-(átlagsebesség-)mérő app, Kristof és apja ötlete. Először web PWA, A9-től natív
**SwiftUI iPhone-app** (Androidot nem célzunk). Az app méri az átlagsebességet a szakaszokon, és
jelzi a határhoz képesti helyzetet. **Új funkció innentől a Swift-appba megy**; a web (`apps/web`)
hibajavítás szintjén marad.

## Monorepo-térkép
| Mappa | Szerep | Fő parancs |
|---|---|---|
| `packages/core` | Függőségmentes mérőmotor (szakasz-felismerés, átlag, tűrés, napállás) | `npm test -w @atlagsebesseg/core`, `npm run fixtures -w @atlagsebesseg/core` |
| `packages/core-swift` | A core 1:1 Swift-portja (`AtlagsebessegCore`), közös fixtúrákkal | `swift test` (a mappában) |
| `packages/data` | OSM-import, HU kézi lista, kamerák, tervezett mérések, edge-bundle, feltöltő | `npm run import:sections`, `npm run import:cameras`, `npm run planned:fetch`, `npm run build:edge` |
| `packages/app-logic` | Közös app-logika (cache, kapuk, Supabase, mérés-munkamenet) | `npm test -w @atlagsebesseg/app-logic` |
| `packages/design-tokens` | Platformfüggetlen dizájn-tokenek, CSS-változók | `npm test -w @atlagsebesseg/design-tokens` |
| `apps/ios` | Natív iPhone-app (SwiftUI, XcodeGen, Mapbox, supabase-swift) | lásd lent: **iOS** |
| `apps/web` | Web PWA (Vite + React, mapbox-gl) – csak hibajavítás | `npm run dev -w @atlagsebesseg/web` |
| `apps/mobile` | Expo-váz, **parkoltatva** (az A9 óta a SwiftUI-app a natív irány) | `npm run typecheck -w @atlagsebesseg/mobile` |
| `supabase/` | Migrációk, edge function, SQL-tesztek | `npm run db:test:local`, `npm run test:edge` |

Gyökér: `npm test` és `npm run typecheck` minden csomagra; `npm run test:all` a teljes lánc
(csomagok + edge + helyi DB).

## Kötelező szabályok
- A `packages/core` **függőségmentes** marad (nincs runtime-függőség).
- Kulcs (service_role, CRON_SECRET, tokenek) **soha** nem kerül repóba, chatbe vagy commitba.
- A `.env` fájlt nem módosítjuk; csak `.env.example` bővíthető.
- RLS: kliensről csak `source = kozosseg` és `verified = false` szakasz írható; az
  OSM/hivatalos adatot csak a service_role tölti.
- UI-ben a dizájn-tokenek a `DESIGN.md`-ből jönnek, nem ad hoc színek/méretek.
- Szakaszadat: a hivatalos adat elsőbbséget élvez, de az OSM-szakasz nem ellenőrzöttként megmarad,
  ha nincs hivatalos párja. Duplikátum = ugyanaz az út, ugyanaz az irány, és a geometria legalább
  70%-ban átfed – ilyenkor csak a hivatalos marad. Minden más OSM-szakasz marad (élőben is csak a duplikátum törlődik).
- Kód-kommentek és commit-üzenetek magyarul.
- **Felirat csak a szótárba**: minden felhasználónak szóló szöveg (UI, chipek, sávok, toastok,
  beállítások, bejelentés-típusok, hibaüzenetek; a szimulátor feliratai kivételek) a
  `packages/app-logic/src/i18n/<nyelv>.json` szótárba kerül, **mind a 6 nyelven** (hu, en, de, sk, cs, pl),
  és `t('kulcs', {param})`-mal kérjük. A teszt bukik, ha egy kulcs bárhonnan hiányzik, és a webes őr
  (`apps/web/test/i18n-guard.test.ts`) ékezetes magyar szöveget keres a kódban.

## iOS (A9)
- **XcodeGen**: a projekt forrása az `apps/ios/project.yml`; az `Atlagsebesseg.xcodeproj` generált és
  gitignore-olt (`cd apps/ios && xcodegen generate`). Kézzel az Xcode-ban ne állíts projektbeállítást –
  a `project.yml`-be kerül, különben a következő generálás felülírja.
- **Titkok xcconfig-ból**: `apps/ios/Secrets.xcconfig` (gitignore; minta: `Secrets.example.xcconfig`;
  kitöltés az `apps/web/.env` nyilvános kulcsaiból: `npm run secrets -w @atlagsebesseg/ios`, értéket nem
  ír ki). Csak nyilvános kulcs (Mapbox `pk.`, Supabase anon) kerülhet bele, service_role soha.
  xcconfig-ban a `//` megjegyzés: URL-ben `https:/$()/…`.
- **Generált fájlok** (`npm run generate -w @atlagsebesseg/ios`, a `npm test` ellenőrzi a frissességet):
  `DesignTokens.swift` (packages/design-tokens), `Localizable.xcstrings` + `InfoPlist.xcstrings` +
  `L10nKey.swift` (a 6 nyelvű szótár), `Icons.swift` (a webes Icon.tsx), `Resources/Sim/*.json` (a webes
  szimulátor). Kézzel nem szerkesztjük őket; szótár- vagy tokenváltozás után újra kell generálni.
- **Felirat az iOS-en is csak a szótárba**: a nézetekben `t(.kulcs, ["x": …])`; az AppTests őre bukik,
  ha ékezetes szöveg vagy `Text("…")`-szerű literál van a kódban (a `Sim/` kivétel).
- **core-swift paritási szabály**: core-változás **mindkét nyelvben** (TS + Swift) ugyanabban a körben,
  és a tesztje a **közös fixtúrán** (`packages/core/fixtures`, leírás: `test/helpers/fixtureSpecs.ts`,
  kiírás: `npm run fixtures -w @atlagsebesseg/core`). Egy TS `it` = egy Swift `@Test`, azonos névvel.
- Ellenőrzés commit előtt (iOS-t érintő változásnál): `xcodebuild test` (AppTests + core-swift a sémában)
  szimulátoron, és `xcodebuild build -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO`.
- Szimulátor: a gépen az iOS 27.1 runtime csak az „iPhone Duo”-t támogatja (szabványos iPhone-hoz
  külön runtime-letöltés kellene); a tesztek és a képernyőképek ezen futnak.

## Kör-rendszer
- Minden prompt „A<n> kör”-rel kezdődik; minden commit-üzenet `A<n>: ...` prefixű.
- A kör végén frissül a `ROUNDS.md` (dátum, modell, fő commit, 1 mondat).

## Zárójelentés (minden kör végén)
1. **Mi készült**
2. **Mi nem és miért**
3. **Tesztek** (számokkal)
4. **Nyitott kérdések** (max 5, döntést kérők)
5. **Mi kell a következő körhöz**

## Tesztszabály
- Commit előtt: `npm test` zöld minden csomagra, `npm run typecheck` tiszta.
- Élő Supabase-teszt csak ROLLBACK-kel (`npm run db:live`).
- Élő migrációt (`npm run db:live`) a Claude Code maga futtat, ha csak hozzáad (új tábla /
  oszlop / nézet / függvény / feltétel); ha adatot vagy oszlopot töröl vagy átnevez, előbb megkérdez.
- Feltöltés (`npm run upload:sections`) után az élő darabszámot ellenőrizni kell, és a
  zárójelentésbe beírni.

## Hol vannak a döntések
- `supabase/README.md` – séma, cron, RLS-indoklás
- `DESIGN.md` – UI, tokenek
- `packages/data/README.md` – adatforrások, ODbL

## Mac-specifikus
Hosszú futás alatt a gép ne aludjon: ezt a **globális** `~/.claude/settings.json`
SessionStart/SessionEnd hookja intézi (`caffeinate -dims -w <claude PID>`, macOS-ellenőrzéssel).
A PID-fájl sessionönkénti: `/tmp/claude-caffeinate-<session_id>.pid` (a `session_id` a hook
stdin-JSON-jából). A SessionStart indítja (ha a sessionnek már fut, nem indít másikat), a
SessionEnd csak a saját session caffeinate-jét állítja le. A `-w` miatt a caffeinate akkor is kilép, ha a
session SessionEnd nélkül hal meg (ilyenkor csak egy ártalmatlan, elárvult PID-fájl marad).

- A hook globális, ezért **minden sessionben fut, bármelyik mappából indul** (ez a projekt, a
  saját mappa, BookMatch stb.). A projektnek nincs saját `.claude/settings.json`-ja, hogy a
  `caffeinate` ne induljon kétszer. A hook-beállítás változása új sessiontől érvényes.
- Párhuzamos sessionök nem állítják le egymás caffeinate-jét (mindegyiknek saját példánya és
  PID-fájlja van; két sessionnel tesztelve).
- **Ellenőrzés** minden hosszú feladat elején: `pgrep -l caffeinate`.
- **Tartalék**, ha üres (a hook nem futott): a Claude Code maga indítja háttérben, és a feladat
  végén leállítja:
  ```bash
  nohup caffeinate -dims >/dev/null 2>&1 </dev/null & echo $! > /tmp/claude-caffeinate-manual.pid
  # a végén:
  kill "$(cat /tmp/claude-caffeinate-manual.pid)" && rm -f /tmp/claude-caffeinate-manual.pid
  ```
  Ha már fut egy `caffeinate`, nem indít másikat.

## Hosszú futások
- Hosszú futású parancsot (import, feltöltés, build) **előtérben** futtass, és a kört **ne zárd
  „várom” állapotban**: a kör addig tart, amíg a feladat kész, vagy döntést kell kérni.
- Ha a parancs túllépi az előtérbeli időkorlátot (10 perc), oszd fel előtérben futó lépésekre
  (pl. `--from`/`--limit`), vagy indítsd háttérben, és ugyanabban a körben, előtérben
  pollozva várd meg a végét – a kört nem zárod le közben.
