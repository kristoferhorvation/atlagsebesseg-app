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
- Szimulátor: az A10 óta az **iOS 27.0 runtime + „iPhone 17 Pro”** (`xcodebuild -downloadPlatform iOS`,
  `xcrun simctl create`); a tesztek és a képernyőképek ezen futnak (`-destination 'platform=iOS Simulator,name=iPhone 17 Pro'`).
  Az iOS 27.1 runtime csak az „iPhone Duo”-t támogatja.
- Jelzések (A10): a logika (`Logic/Alerts.swift`, `Logic/PlannedChecks.swift`) hang nélkül, eseményeket ad
  (`AlertEvent`); a hang-réteg (`Audio/AlertPlayer.swift`) csak lejátszik. Új jelzés-szabály teszttel az
  eseményszinten. A `.playback` munkamenet a némítás-kapcsolót nem követi – ezt a „Jelzés módja” beállítás adja;
  „ki” módban a sáv marad, csak hang és rezgés nincs (`AlertDispatcher`). **Döntés (2026-10-29):** iránnyal
  megadott kamera ellenirányban nem szól (nem a mi irányunkat méri); a visszaforduláskori újrajelzés csak irány
  nélküli kamerára és a szakaszkapura igaz.
- Közös konstansok a webbel: a tervezett mérés sávjának tűrése (`PLANNED_MATCH_M`, 100 m), a letérés-küszöb és a
  navigációs útvonal-elemzés tűrése (`ROUTE_MATCH_M`, 40 m – szakasz / kamera / tervezett mérés az útvonalon) az
  app-logicban van; az iOS a generált `Generated/AppLogicConstants.swift`-ből olvassa. A kettő szándékosan külön.
- Betű: **Inter** (mint a weben) – `Resources/Fonts/InterVariable.ttf` (OFL, `Inter-OFL.txt`), `UIAppFonts`;
  a nézetekben `Font.inter(méret, súly)` / `.num(…)` a token pontos súlyával. Rendszerbetű (`.system(size:)`)
  nem kerülhet a kódba (AppTests-őr).
- Háttér-mérés: a mérés zárolt képernyővel is fut, külön figyelmeztetés nincs (döntés). A zárolt képernyős
  „fut a mérés” jelzés a Live Activity (A12+) dolga.
- Navigáció (A11): a logika az `apps/ios/Atlagsebesseg/Navigation/` mappában – a `packages/app-logic/src/navigation`
  1:1 portja (Directions-feldolgozás, útvonal menti szakasz/kamera/mérés, `NavigationSession`, keresés, helyek,
  költségvédelem). **Paritási szabály, mint a core-nál:** navigációs logika-változás mindkét nyelvben ugyanabban a
  körben; a `AtlagsebessegTests/NavigationTests.swift` a `navigation.test.ts` párja (egy TS `it` = egy Swift `@Test`,
  azonos névvel), ugyanazon a közös fixtúrán (`packages/app-logic/src/navigation/fixtures/budapest-gyor.directions.json`,
  a `project.yml` erőforrásként hivatkozza, nem másolat). A küszöbök (`NAV_CONFIG`, `NAV_COUNTRIES`) generáltak
  (`Generated/AppLogicConstants.swift`), a manőver-ikonok a webes `ManeuverIcon.tsx`-ből (`Generated/ManeuverIcons.swift`).
  Az `RouteFetcher` szinkron indul és `Task`-ot ad (a költségvédelem azonnal érvényes, mint a weben a Promise első
  lépése); a tesztek a `settle()`-lel várják be a választ (a webes `flush()`).
- Navigációs UI (A11): a kereső **pill** felül, a GPS/Kijelző pillek jobb oldalán (csak az üres nézeten); érintésre
  teljes szélességű keresőmező nyílik a térkép tetején (billentyűzet, az utolsó 10 cím), alul nincs kereső
  (Kristof, 2026-10-29). **Alternatív útvonal (A8d, Kristof 2026-10-29):** tömör szürkéskék vonal (`idle` token) casinggel,
  „+/− perc” címkével a kiválasztotthoz képest, érintésre (vonal vagy címke) arra vált. Mérés közben a mérőkártya a fő,
  a navigációs lépés egysoros sáv fölötte; a „Lassíts” sáv e fölé kerül. Hang: az `AlertPlayer` szintetizátora
  (`announce`), a fontos mondat (szakasz, túl gyors, újratervezés, gyorsabb út) megszakítja a fordulót.
- Navigációs szimulátor: `-sim navsim` indulás előtt a kiindulóponton áll, a lejátszás a navigáció indításakor kezdődik
  (mint a webes `/?navsim`); `-navStage search|picker|nav` (és `-navQuery`) egy állapotba ugrik, a `-simSeek` az
  ugrás előtti utolsó ablak elejéről játszik le. A bemondások szimulátorban a naplóba is mennek (`NAV-VOICE`).

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
A gép a **munka idejére** marad ébren, nem a session egész élettartamára. Ezt a **globális**
`~/.claude/settings.json` hookjai intézik (macOS-ellenőrzéssel):
- `UserPromptSubmit`: ha a sessionhöz nincs élő caffeinate, indít egyet
  (`caffeinate -dims -t 14400 -w <claude PID>`). SessionStart nem indít caffeinate-et.
- `Stop`: leállítja a saját session caffeinate-jét; `SessionEnd`: ugyanez, tartaléknak.
- PID-fájl: `/tmp/claude-caffeinate-<session_id>.pid` (a `session_id` a hook stdin-JSON-jából).
  A leállítás csak akkor öl, ha a PID-ben lévő folyamat tényleg `caffeinate`, így az elárvult
  fájl vagy egy újrahasznált PID nem okoz hibát.
- A `-t 14400` biztonsági határ: ha megszakítás miatt nem fut le a Stop, 4 óra után a caffeinate
  magától lejár. A `-w` miatt kilép akkor is, ha a Claude-processz meghal.

- A hook globális, ezért **minden sessionben fut, bármelyik mappából indul** (ez a projekt, a
  saját mappa, BookMatch stb.). A projektnek nincs saját `.claude/settings.json`-ja, hogy a
  `caffeinate` ne induljon kétszer. A hook-beállítás változása új sessiontől érvényes.
- Párhuzamos sessionök nem állítják le egymás caffeinate-jét (sessionönként külön PID-fájl;
  két sessionnel tesztelve).
- **Ellenőrzés**: egy prompt alatt `pgrep -l caffeinate` egy sort mutat, a válasz után üres.
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
