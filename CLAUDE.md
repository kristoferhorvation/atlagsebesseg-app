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
- Navigáció (AOS11): a logika az `apps/ios/Atlagsebesseg/Navigation/` mappában – a `packages/app-logic/src/navigation`
  1:1 portja (Directions-feldolgozás, útvonal menti szakasz/kamera/mérés, `NavigationSession`, keresés, helyek,
  költségvédelem). **Paritási szabály, mint a core-nál:** navigációs logika-változás mindkét nyelvben ugyanabban a
  körben; a `AtlagsebessegTests/NavigationTests.swift` a `navigation.test.ts` párja (egy TS `it` = egy Swift `@Test`,
  azonos névvel), ugyanazon a közös fixtúrán (`packages/app-logic/src/navigation/fixtures/budapest-gyor.directions.json`,
  a `project.yml` erőforrásként hivatkozza, nem másolat). A küszöbök (`NAV_CONFIG`, `NAV_COUNTRIES`) generáltak
  (`Generated/AppLogicConstants.swift`), a manőver-ikonok a webes `ManeuverIcon.tsx`-ből (`Generated/ManeuverIcons.swift`).
  Az `RouteFetcher` szinkron indul és `Task`-ot ad (a költségvédelem azonnal érvényes, mint a weben a Promise első
  lépése); a tesztek a `settle()`-lel várják be a választ (a webes `flush()`).
- Navigációs UI (AOS11): a kereső **pill** felül, a GPS-pill jobb oldalán (csak az üres nézeten; AOS12: a „Kijelző ébren”
  pill iOS-en nincs); érintésre teljes szélességű keresőmező nyílik a térkép tetején (billentyűzet, mentett címek
  chip-sora, az utolsó 10 cím), alul nincs kereső (Kristof, 2026-10-29). **Alternatív útvonal (AW11, AOS12-ben portolva):**
  a kiválasztott `route` 7 pt + 2 × 2 pt `routeCasing`, az alternatíva 5 pt `routeAltDay`/`routeAltNight` + 1,5 pt
  kontúr (nappal / hajnal 55/45 sötét, éjjel / alkony 70/30 világos), „+/− perc” címke a leágazás után 300 m-rel
  (`altLabels`), érintésre (vonal vagy címke) arra vált. Mérés közben a mérőkártya a fő,
  a navigációs lépés egysoros sáv fölötte; a „Lassíts” sáv e fölé kerül. **AOS13 (weben és iOS-en):** az alsó
  kártya-csoport soha nem ér a felső lépés-kártya alá – ha a teljes kártya (+ 12 pt) nem fér ki, a lépés mérésen kívül is
  egysoros sáv (`navStepStrip`, `navigation/layout.ts` / `Navigation/Layout.swift`; a rejtett kártyát is mérjük, az alsó
  csoport tetejét a sáv nélkül, hogy ne villogjon), és navigáció közben a mérés eredménye (`befejezve`) egysoros, kompakt
  kártya (`navResultCompact`); AW15 óta a kézi mérésé is. Hang: az `AlertPlayer` szintetizátora
  (`announce`), a fontos mondat (szakasz, túl gyors, újratervezés, gyorsabb út) megszakítja a fordulót.
- **AW12 (első éles navi-teszt, Kristof 2026-10-29), weben és iOS-en (AOS12) kész:** „Gyorsabb út” ≥ 2 perc nyereségtől,
  `net = Δperc − k·Δkm` (k az alternatíva átlagsebességéből, 40 km/h-ig 1,0, 110-től 0,3) → Megéri (45 s után elfogad) /
  Lehet / Nem éri meg (45 s után marad); ~~mérés közben a végkapu utáni 1 km-en belüli lehajtóra nincs ajánlat~~ (hibás
  volt, az AW13 javította, lásd lent); az „Újratervezés” hang a letérés kezdetén; kamera `max(250 m, 10 s × v)`-n belül borostyán felső sáv + egy rezgés;
  „Utána” sor: ikon + utcanév / rövid manőver-szó (`thenText`); érkezés: a Geocoding `routable_points`-ra tervezünk, az
  `arriveM`-nél rövidebb utolsó lépés beolvad az érkezésbe (`absorbArrivalStub`); követő zoom `navFollowZoom`, az autó az
  alsó harmadban (`NAV_FOLLOW`). Konstansok: `ALT_OFFER`, `CAMERA_ALERT`, `NAV_FOLLOW` (`navigation/config.ts`; iOS-re
  generálva a `Generated/AppLogicConstants.swift`-be). A régi `altMinGainS`/`altMinGainFraction` mindkét nyelvből törölve.
- **AW13 (Kristof 2026-10-29), weben és iOS-en (AOS12) kész:**
  - **Gyorsabb út mérés közben:** ha a lehajtó a mért szakasz végkapuja **előtt**, vagy a végkapu **után legfeljebb 1 km-rel**
    van (`ALT_OFFER.exitAfterGateM` = 1000 m, a határ még azonnali), az ajánlat **azonnal** megjelenik kompakt kártyával
    és bemondással, mint a kapu előtti esetben. Csak az 1 km-nél távolabbi lehajtó vár a mérés végéig (visszatartva, a
    mérés végén jelenik meg). Ugyanez érvényes, ha már látható ajánlat mellett kezdődik mérés: 1 km-en belül → marad
    (kompakt), azon túl → visszatartva. Kézi mérésnél nincs végkapu → visszatartva. (`NavigationSession.exitNearSectionEnd`.)
  - A kiemelt (45 s után magától történő) gomb alatt vékony, fogyó csík, szám nélkül: `AlternativeOffer.timeLeft` (1 → 0).
  - A kompakt (mérés közbeni) kártya **kétsoros**, 390 px-en sem vágódik le: „Kijárat 56” / „2,1 km · −7 perc”
    (`altOfferCompactLines`, `nav.offer.compactDetail`); név nélküli lehajtónál „Lehajtó 2,1 km-nél” / „−7 perc”,
    ismeretlen lehajtónál a cím egy sorban. A kategória a sor színéből látszik.
  - „Megéri” bemondás a lehajtóval: `nav.voice.fasterWorthExit` („Gyorsabb út, {n} perc megtakarítás, lehajtó {km}
    kilométernél”, a km a lehajtóig, egy tizedessel); ismeretlen lehajtónál a régi `nav.voice.faster`. A „Lehet” és a
    „Nem éri meg” szövege nem változott.
  - Helyhozzáférés (`packages/app-logic/src/location.ts`): indításkor automatikus kérés; `retryOnGesture` – az első
    érintés / kattintás bárhol újra kér, ha nincs pozíció és az engedély eldöntetlen (Mac Safari gesztus nélkül nem
    kérdez); a GPS-pill `gpsPillAction`: `prompt` → kérés, `denied` → kis lap („A helyhozzáférés le van tiltva” + a
    bekapcsolás útja: `deniedHelpSteps(detectBrowser(ua, maxTouchPoints))` – iOS Safari / Mac Safari / Chrome / Android
    Chrome / egyéb), `granted` → csak pontosság, koppintásra semmi. iOS-en (`Location/LocationAccess.swift`):
    `notDetermined` → kérés, `denied`/`restricted` → lap (`GeoBlockedSheet`, `ios.geo.*`) a „Megnyitás” gombbal – ez
    az app saját beállításait nyitja (`openSettingsURLString`; az Adatvédelem › Helymeghatározás oldalra nyilvános API
    nem visz), `granted` → semmi. A `retryOnGesture` iOS-en nem kell.
  - **AW14 (élesben iPhone Safarin: zöld pill ±8 m, mégis tiltott-lap):** a GPS-pillnél a **helyzet-állapot nyer** a
    Permissions API / az engedély felett – van pozíció (`aktiv`; iOS-en `active`/`sim`) → semmi, lap soha. Az engedély
    csak pozíció nélkül számít; ha az API nincs vagy hibát ad (`unknown`), „prompt”-nak vesszük (kérés), nem tiltottnak.
- **AW15 (Kristof + apja, 2026-10-29), weben és iOS-en kész:**
  - Nyelvválasztó: „Automatikus” legfelül, utána zászló + saját név ábécérendben (`languageMenu`, `LANGUAGE_FLAGS`;
    iOS-re generálva). **iOS-en saját választó** (Kristof döntése): `LangChoice` (`lang:v1`, mint a weben), a `t()` ebből
    olvas; megfigyelhető, így a nézetek a választásra újrarajzolnak; beágyazott lista a Beállításokban.
  - Mentett hely (Haza / Munka / Új hely): a kereső a Beállítások **fölött** nyílik, választás után a lap nyitva marad,
    ugyanott (web: `SearchScreen` z-index + az Escape csak a keresőt zárja; iOS: `fullScreenCover` a lapon, `placeSearchOpen`).
  - Térkép: `MapLook` = `szines` / `visszafogott` / `vilagos`; `mapTheme`, `mapLightPreset` (a „Világos” mindig `day`, a
    rétegek is nappali tokenekkel); világos térképen az üveg `surfaceStrong` (web: `:root[data-look]`, iOS: `strongGlass`).
  - Kézi átlagmérés („Kézi átlagmérés” a cím és a chip): navigáció közben pill-állapotgép (`manualPillTick` /
    `manualPillTap` / `navNeedsSpace`, `MANUAL_PILL` = 5 s, 500 m; `navigation/layout.ts` / `Layout.swift`), a pill alatt
    a navigáció úgy látszik, mint mérés nélkül; a kézi eredmény navigáció közben kompakt (`navResultCompact`).
  - Helyhozzáférés (csak web): a GPS-pill újrakérésére jött PERMISSION_DENIED (1) a tiltott-lapot nyitja, Permissions API
    nélkül is (`pillRequestError`); az automatikus és az első-gesztusos kérés elutasítása nem nyit lapot.
  - Szimulátor: `-manual S` (a `-navStage nav` mellett kézi mérés, S mp múlva leáll; 0: fut), `-settingsOpen language`.
- **AW16 (Kristof visszajelzése az AW15-re, 2026-10-30), weben és iOS-en kész:**
  - **Kézi átlagmérés zsugorítva** (navigáció közben): nem pill, hanem a mérőkártya lekicsinyített változata a jobb oldalon
    (`ManualMini`): a nagy átlag-szám mindig a kézi mérés semleges (accent, `kezi`) színében, mint a teljes kézi kártyán – kézi
    mérésnél nincs referencia, a sofőr magának méri (**javítva:** az első AW16-változat a navigáció sebességhatárához mért
    zöld / borostyán / piros színt adott, ez kikerült, a `-miniStatus` / `?miniStatus=` kapcsolókkal együtt); alatta
    „km/h átlag” és az eltelt idő; Leállítás nélkül. Bökésre a teljes kártya, bökésre vagy 5 s után vissza. Auto-zsugor: manőver < 500 m, ajánlat-kártya,
    közeli kamera. **Indítás után az első 5 s-ban** hely-igény mellett is nyitva marad, de 3 s után (az indítástól) összemegy
    (`MANUAL_PILL.startSpaceCollapseMs`, `ManualPillState.initial`). A függvénynevek (`manualPillTick`/`manualPillTap`) maradtak.
  - **A kézi mérés privát:** nem küld semmit a szerverre, hálózat nélkül is megy. Az „ideiglenes szakasz” folyamat (kézi
    mérés + kezdő/záró kapu küldése, „Újra” gomb, `gate.*` / `toast.*` szövegek, `gateReportsFromManual`) kikerült. Helyette a
    Bejelentés menü alján két új típus: **„Átlagmérés eleje”** és **„Átlagmérés vége”** (`kapu_kezdo` / `kapu_zaro`, 6 nyelv) –
    a meglévő kapu-jelentés (`reportFromFix`, `ideiglenes_kapu` + `gate_kind`), ismeretlen mérési zóna bejelentésére; irány nélkül
    nem küldhető. A core `ManualResult.gates` (TS + Swift, közös fixtúra) a paritás miatt érintetlen, az app már nem használja.
  - **Térképstílus-szabály:** a készülék sötét módja SEHOL nem számít. Napközben a beállítás dönt: „Világos” = nappali fény
    (`day`), „Színes” (alap) = alkonyi fény (`dusk`); hajnalban (`dawn`), napnyugtakor (`dusk`) és éjjel (`night`) mindkettő
    a napszaké; „Visszafogott” a napszak szerint. Sorrend a választóban: Világos, Színes, Visszafogott (`MAP_LOOKS`). Az erősebb
    üveg (`strongGlassFor`) csak a nappali fényű „Világos” térképen. `chooseLightPreset(phase)`, `lightPresetAt(now, pos)`,
    `mapLightPreset(look, preset)` – webes és Swift-változat azonos szabállyal.
  - **Kereső:** kerek ikon-gomb (mint az alsó kerek gombok) a térkép tetején, a GPS-pill sorában, a jobb szélre zárva; csak az üres
    nézeten; az alsó gombsorból kikerült, iOS-en a kereső-pill helyett ugyanez. Érintésre teljes szélességű keresés, mint eddig.
  - **iOS nyelvválasztó:** egy sor („Nyelv · 🇭🇺 Magyar”), koppintásra nyíló választó; a tárolás (`lang:v1`) és az azonnali váltás marad.
  - ~~**Paritási tartozás (AW16 → AOS14):** az iOS-nek még nincs bejelentés-funkciója~~ – **lezárva az AOS14-ben** (lásd lent).
- **AOS14 (2026-10-30), weben és iOS-en kész:**
  - **Bejelentés + szavazás iOS-en** (a web A5 + AW16 1:1 portja, `Logic/Reports.swift`, `App/AppModel+Reports.swift`,
    `UI/ReportViews.swift`): a figyelmeztető-ikon gomb (az alsó gombsor jobb szélén, mindig) nyitja a Bejelentés menüt a webes
    `REPORT_CHOICES` tételeivel és sorrendjével (a kapu alul, irány nélkül nem küldhető); `reports` írás, `active_reports`
    olvasás a látható téglalapra (`reportQuery`, a `MapScreen` küldi a kamera-mozdulatból) vagy a pozíció körül, 60 s-enként
    (`ReportFeed`); jelölők a térképen, koppintásra a kártya (Megerősítés / Nincs ott, `report_votes`, mérés közben 3 s után
    zár), toast. A szimulátorban a webes `simReports` mintái (a generált `Resources/Sim/*.json` `reports` mezője; a navsim-ben
    egy rendőrség-bejelentés 1400 m-nél). **Javítva (Kristof, 2026-10-30):** a szimulátor is az éles Supabase-re küldi a
    bejelentést, mint a web (tesztadat, élesítés előtt mindkét platformon egyszerre zárjuk le); a szavazat a minta-bejelentésre
    helyben marad (azok nincsenek a szerveren – a webes szimulátor ugyanígy), valódi bejelentésre a szerverre megy.
    `-reportOpen YES`: a menü nyitva (képernyőkép). **Élő próba (csak DEBUG):** `-autoReport <típus>` (egyszer bejelent),
    `-autoVoteId <uuid> -autoVote YES|NO` (egyszer szavaz) – a fej nélküli szimulátorban érintés nélkül; 2026-10-30-án
    kipróbálva: a `reports` sor és a `report_votes` sor megjelent, a `confirmations` 1-re nőtt.
  - **Egy kapu-tétel (javítva, weben és iOS-en):** az „Átlagmérés eleje” és „vége” EGY tétel a menü végén (`reportMenu`): sikeres
    „eleje” után ugyanaz a sor „Átlagmérés vége” (jegyzet: `report.note.gateEnd`), amíg el nem küldik, vagy a mérés / navigáció
    véget nem ér (`gateStartedAfter`); utána vissza „eleje”.
  - **Közeledő bejelentés: EGY kártya – ÚJ, weben és iOS-en** (Kristof döntései az AOS14-ben: a webnek eddig csak koppintásos
    kártyája volt; javítva: egy kártya a kamera-figyelmeztetés helyén). `packages/app-logic/src/reportPrompt.ts` /
    `Logic/Reports.swift` (`ReportPromptWatch`, `reportPromptCandidate`, `reportAlertM`, `REPORT_PROMPT` – iOS-re generálva):
    előttünk (±45°) a kamerával azonos `max(250 m, 10 s × v)` távolságon belül figyelmeztet („Rendőrség 240 m”,
    `report.alert.ahead`), 200 m-en belül (irány nélkül 50 m-en belül) UGYANAZ a sor helyben „Még ott van? Igen / Nem”-re vált.
    Helye: navigációban a manőverkártyán, a kamera-sor helyén és stílusában (a kártya borostyán; a közeli kamera elsőbbséget
    kap); navigáció nélkül vagy sáv-módban önálló borostyán kártya ugyanott (weben a kereső-gomb sora alatt). Válasz, elhaladás
    vagy a kérdés után 10 s → eltűnik, és arra a bejelentésre nem tér vissza; a sajátra és a megszavazottra soha. **Elhaladás**
    csak akkor, ha már 100 m-en belül voltunk és most mögöttünk (>90°) van (`REPORT_PASSED_NEAR_M` – hajtűkanyarban a légvonal
    megtéveszt), vagy ha 2 × a figyelmeztetési távolságnál messzebb kerültünk. A koppintott jelölő kártyája külön, lent (Megerősítés /
    Nincs ott). Teszt: `reportPrompt.test.ts` ↔ `ReportTests.swift` (azonos nevekkel). Küszöbök (200 m, ±45°, 10 s, 50 m):
    maradnak, éles vezetés után finomítjuk (Kristof).
  - **Live Activity (csak iOS, platformspecifikus):** `AtlagsebessegWidget` app-extension a `project.yml`-ben (a közös fájlok – az
    adatszerkezet `LiveActivity/DriveActivity.swift`, a tokenek, a betű `UI/InterFont.swift`, a manőver-rajzok és
    `Navigation/ManeuverIconKind.swift` – az app forrásaiból fordulnak, nem másolatok; a nézetek
    `AtlagsebessegWidget/LiveActivityViews.swift`, ezt az app is fordítja a mock-előnézethez). Az app számol és fordít
    (`liveActivityState`, a widget a `lang:v1`-et nem látja): mérés közben átlag (státusz-színnel), tábla-limit, most, várható,
    hátralévő km; kézi mérésnél csak az átlag accent színben, limit nélkül; navigációban manőver + távolság + utcanév + érkezés;
    együtt a mérés dominál, a manőver egy kompakt sorban. `LiveActivityController`: indul mérés / navigáció kezdetén, ≤ 1 Hz és
    csak változáskor frissít, a végén `.immediate` zárul, induláskor a korábbi futásból maradtakat lezárja; a háttér nem állítja
    le. **Korlát:** az ActivityKit háttérből nem indít új Live Activity-t – háttérben induló szakaszmérésnél csak a következő
    előtérbe kerüléskor jelenik meg; **AOS15:** a Live Activity a GPS indításától állandóan látszik, térképképpel (Kristof döntése). **Képernyőkép:** a fej nélküli szimulátoron a lezárt képernyő és a Dynamic Island nem
    fotózható → `-livePreview YES` (a `-sim …` mellett): a widget saját nézetei az app élő állapotából (`Sim/LiveActivityPreview.swift`, mock).
  - **Köszöntés (web + iOS):** Beállítások › „Megszólítás” (opcionális, `megszolitas`, ≤ 24 karakter, `normalizeName`); az üres
    nézeten a kereső-gomb sora alatt, balra „Szia Kristof!” / „Szia!” (`greetingText`); navigáció indításakor (bekapcsolt hangos
    utasításoknál) „Szia Kristof, indulhatunk!” / „Szia, indulhatunk!” (`greetingVoice`, az indulási utasítás előtt); kézi
    mérésnél nincs. 6 nyelv, a hang az app nyelvén.
  - **Paritási tartozás (iOS):** a fix kamera koppintásos kártyája (webes `CameraCard`) iOS-en még nincs (az AOS14 előtti hiány).
- **Paritási tartozás (AW12 + AW13 → iOS) lezárva az AOS12-ben (2026-10-29):** a `NavigationTests.swift` újra a
  `navigation.test.ts` teljes párja (86 = 86 `it`, azonos névvel), a webes `navSim.test.ts` 6 esete a `SimTests.swift`-ben.
  A közös Budapest→Győr fixtúra **AOS13-ban teljesen újra felvéve** méteres hangegységgel (`voice_units=metric`, mindkét
  útvonal élő, egy hívásból; 2026-10-29 18:57): fő útvonal M1 + M19, 121,3 km / 16 lépés, alternatíva M1 + 8136, 128,6 km,
  lehajtó „Kijárat 67” ~67 km-nél. Felvétel: `npx tsx apps/web/scripts/record-directions-fixture.mjs` (az app
  `directionsUrl`-je; egy útvonalnál nem ír, `--keep-alt`-tal a régi 2. útvonalat tartja, a mérföldes lépései hang nélkül).
- Navigációs szimulátor: `-sim navsim` indulás előtt a kiindulóponton áll, a lejátszás a navigáció indításakor kezdődik
  (mint a webes `/?navsim`); `-navStage search|picker|nav` (és `-navQuery`) egy állapotba ugrik, a `-simSeek` az
  ugrás előtti utolsó ablak elejéről játszik le. A bemondások szimulátorban a naplóba is mennek (`NAV-VOICE`). AOS12:
  `-alt worth|maybe|not|aftergate|off` (a webes `?alt=`; az adat a generált navsim-fixtúrából: `sectionEndM`, `alts`),
  `-geoHelp YES` (a tiltott-lap a képernyőképhez).

## Web–iOS paritás (Kristof, 2026-10-30)
- **A web a referencia:** minden webes funkció iOS-re is megy ugyanabban vagy a következő AOS-körben, kivéve a platformspecifikusat
  (CarPlay, Live Activity, böngésző-engedély és hasonló). Paritás-hiány = **tartozás**: a CLAUDE.md-ben jelöljük, és a
  zárójelentésben felsoroljuk, amíg nem zárul.

## Kör-rendszer
- Kör-számozás (2026-10-29-től): **AW<n>** = web, **AOS<n>** = iOS; a sorszám az eddigi A1–A10-et folytatja
  (az első ilyen kör a web AW11 és a vele párhuzamos iOS-navigáció AOS11). Az A1–A10 sorok neve marad.
- Minden prompt „AW<n> kör” vagy „AOS<n> kör”-rel kezdődik; minden commit-üzenet `AW<n>: ...` / `AOS<n>: ...` prefixű.
- A kör végén frissül a `ROUNDS.md` (dátum, modell, fő commit, 1 mondat); **minden sor végén** `(local)` vagy
  `(cloud)` – hol készült a kör (felhőben készült, helyben lezárt kör: `(cloud, lezárás local)`).
- **Körben talált hiba (Kristof, 2026-10-29):** a kör közben talált hibát **ugyanabban a körben javítjuk, ha kicsi**.
  Ha nagy, a kör **elején** jelezzük és döntést kérünk – nem a zárójelentésben (ott legfeljebb a már eldöntött
  kérdésre hivatkozunk).
- **Worktree és ágak (Kristof, 2026-10-29):** ha a fő mappában (`~/Desktop/atlagsebesseg-app`) másik kör fut, külön
  worktree-ben dolgozunk (pl. `../atlagsebesseg-<kör>`). A munka **worktree-ből is mindig a mainre kerül, ágon semmi nem
  marad**: a kör végén `git fetch` + rebase az `origin/main`-re, push a mainre (`git push origin HEAD:main`), ellenőrzés,
  hogy a commit a mainen van (`git branch -r --contains <commit>` → `origin/main`), majd a worktree (`git worktree remove`)
  és a helyi ág (`git branch -d`) törlése. Régi worktree-t csak akkor törlünk, ha nincs benne commitolatlan vagy
  pusholatlan változás.

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
