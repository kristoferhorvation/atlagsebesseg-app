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
  „fut a mérés” jelzés a Live Activity (AOS14 óta, lásd lent; AOS15: a GPS indításától állandóan).
- Navigáció (AOS11): a logika az `apps/ios/Atlagsebesseg/Navigation/` mappában – a `packages/app-logic/src/navigation`
  1:1 portja (Directions-feldolgozás, útvonal menti szakasz/kamera/mérés, `NavigationSession`, keresés, helyek,
  költségvédelem). **Paritási szabály, mint a core-nál:** navigációs logika-változás mindkét nyelvben ugyanabban a
  körben; a `AtlagsebessegTests/NavigationTests.swift` a `navigation.test.ts` párja (egy TS `it` = egy Swift `@Test`,
  azonos névvel), ugyanazon a közös fixtúrán (`packages/app-logic/src/navigation/fixtures/budapest-gyor.directions.json`,
  a `project.yml` erőforrásként hivatkozza, nem másolat). A küszöbök (`NAV_CONFIG`, `NAV_COUNTRIES`) generáltak
  (`Generated/AppLogicConstants.swift`), a manőver-ikonok a webes `ManeuverIcon.tsx`-ből (`Generated/ManeuverIcons.swift`).
  Az `RouteFetcher` szinkron indul és `Task`-ot ad (a költségvédelem azonnal érvényes, mint a weben a Promise első
  lépése); a tesztek a `settle()`-lel várják be a választ (a webes `flush()`).
- Navigációs UI (AOS11): a kereső **pill** felül, a GPS-pill jobb oldalán (csak az üres nézeten; ~~AOS12: a „Kijelző ébren”
  pill iOS-en nincs~~ – AOS18: ugyanott van, mint a weben); érintésre teljes szélességű keresőmező nyílik a térkép tetején (billentyűzet, mentett címek
  chip-sora, az utolsó 10 cím), alul nincs kereső (Kristof, 2026-10-29). **Alternatív útvonal (AW11, AOS12-ben portolva):**
  a kiválasztott `route` 7 pt + 2 × 2 pt `routeCasing`, az alternatíva 5 pt `routeAltDay`/`routeAltNight` + 1,5 pt
  kontúr (nappal / hajnal 55/45 sötét, éjjel / alkony 70/30 világos), „+/− perc” címke (`altLabels`; AW17 óta a helye
  képernyő-pontban számolt, lásd lent), érintésre (vonal vagy címke) arra vált. Mérés közben a mérőkártya a fő,
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
    `report.alert.ahead`), **50 m-rel a bejelentés előtt** (`REPORT_PROMPT.nearM`; álló autónál irány nélkül is 50 m-en belül)
    UGYANAZ a sor helyben „Még ott van? Igen / Nem”-re vált (javítás 2, Kristof: korábban 200 m-nél).
    Helye: navigációban a manőverkártyán, a kamera-sor helyén és stílusában (a kártya borostyán; a közeli kamera elsőbbséget
    kap); navigáció nélkül vagy sáv-módban önálló borostyán kártya ugyanott (weben a kereső-gomb sora alatt). A kérdés az
    **elhaladás után még 10 s-ig** látható (elhaladás előtt nincs időkorlát), aztán eltűnik; válaszra azonnal. Kérdés nélkül (a
    bejelentés 50 m-nél messzebb maradt) az elhaladáskor rögtön eltűnik. Arra a bejelentésre nem tér vissza; a sajátra és a
    megszavazottra soha. **Elhaladás:** mögöttünk (>90°) van, és már a közelében jártunk (kérdés-fázisban 50 m, egyébként
    `REPORT_PASSED_NEAR_M` = 100 m – hajtűkanyarban a légvonal megtéveszt); 2 × a figyelmeztetési távolságnál messzebb kerülve
    is vége. A koppintott jelölő kártyája külön, lent (Megerősítés /
    Nincs ott). Teszt: `reportPrompt.test.ts` ↔ `ReportTests.swift` (azonos nevekkel). Küszöbök (50 m, ±45°, 10 s az elhaladás
    után): éles vezetés után finomítjuk (Kristof). Képernyőkép: `-gateStarted YES` (a menü „Átlagmérés vége” állapota).
  - **Live Activity (csak iOS, platformspecifikus):** `AtlagsebessegWidget` app-extension a `project.yml`-ben (a közös fájlok – az
    adatszerkezet `LiveActivity/DriveActivity.swift`, a tokenek, a betű `UI/InterFont.swift`, a manőver-rajzok és
    `Navigation/ManeuverIconKind.swift` – az app forrásaiból fordulnak, nem másolatok; a nézetek
    `AtlagsebessegWidget/LiveActivityViews.swift`, ezt az app is fordítja a mock-előnézethez). Az app számol és fordít
    (`liveActivityState`, a widget a `lang:v1`-et nem látja): mérés közben átlag (státusz-színnel), tábla-limit, most, várható,
    hátralévő km; kézi mérésnél csak az átlag accent színben, limit nélkül; navigációban manőver + távolság + utcanév + érkezés;
    együtt a mérés dominál, a manőver egy kompakt sorban. `LiveActivityController`: indul mérés / navigáció kezdetén, ≤ 1 Hz és
    csak változáskor frissít, a végén `.immediate` zárul, induláskor a korábbi futásból maradtakat lezárja; a háttér nem állítja
    le. **Korlát:** az ActivityKit háttérből nem indít új Live Activity-t – háttérben induló szakaszmérésnél csak a következő
    előtérbe kerüléskor jelenik meg – **megszűnt az AOS15-ben:** a Live Activity a GPS indításától állandó, térképképpel (lásd lent). **Képernyőkép:** a fej nélküli szimulátoron a lezárt képernyő és a Dynamic Island nem
    fotózható → `-livePreview YES` (a `-sim …` mellett): a widget saját nézetei az app élő állapotából (`Sim/LiveActivityPreview.swift`, mock).
  - **Köszöntés (web + iOS):** Beállítások › „Megszólítás” (opcionális, `megszolitas`, ≤ 24 karakter, `normalizeName`); az üres
    nézeten a kereső-gomb sora alatt, balra „Szia Kristof!” / „Szia!” (`greetingText`); navigáció indításakor (bekapcsolt hangos
    utasításoknál) „Szia Kristof, indulhatunk!” / „Szia, indulhatunk!” (`greetingVoice`, az indulási utasítás előtt); kézi
    mérésnél nincs. 6 nyelv, a hang az app nyelvén.
  - ~~**Paritási tartozás (iOS):** a fix kamera koppintásos kártyája (webes `CameraCard`) iOS-en még nincs~~ – **lezárva az AOS15-ben**.
- **AW17 (Kristof, 2026-10-30), weben és iOS-en kész:**
  - **Elrendezés navigáció közben:** az alsó sáv (`NavBottom` / `NavBottomBar`) mindig a képernyő alján, a mérőkártya és minden
    más kártya fölötte; szakaszmérés közben sebesség nélkül (`navBottomShowsSpeed`), a km/h piros, ha a bal alsó tábla
    (Mapbox-limit, `nav.limitKmh`) fölött van (`navSpeedOver`, csak szín). Mérés + ajánlat: egysoros mérőkártya
    (`navMeterCompact`); **javítva:** ilyenkor nincs külön „Lassíts” sáv (`slowDownBarShown`), a max érték („max 103” /
    „nem hozható”, `compactMeterBarText`) a kártyán a státusz színében; az ajánlat után a sáv visszajön. A szimulátor
    „visszahajtás” fejlépését az alternatíva hossztól függetlenül elhagyja (egy 200 m-es fejlépés lett a „lehajtó”, és az
    auto-váltás azonnal átváltott). A külön kerek „Befejezés” gomb megszűnt (a sávban mindig ott van). Mivel a közeledés-kártya is az alsó sáv
    fölé kerül, a lépés-sáv (`navStepStrip`) már a mérés előtt is megjelenhet, ha a teljes felső kártya nem fér ki.
  - **Ajánlat:** kompakt szöveg „Kijárat 56 · 2,5 km · −7 perc gyorsabb” (`altOfferCompactText`, `nav.offer.compactDetail` /
    `nav.offer.compactFaster`, 6 nyelv). **Auto-váltás:** „Megéri” ajánlatnál a lehajtó 500 m-en belül (`ALT_OFFER.autoSwitchExitM`)
    azonnal elfogad, nem várja ki a 45 s-ot; „Lehet” / „Nem éri meg” esetén nincs. A hang a kézi elfogadásé – külön elfogadás-
    bemondás nincs a kódban: az új útvonal következő manőver-bemondása szól (ugyanabban a lépésben, mint kézi elfogadásnál), a
    „lehajtó 500 méternél” ismétlés elmarad. A szimulátor lehajtója 400 → 800 m (különben a kártya azonnal eltűnne).
  - **„Utána” sor** csak akkor, ha a következő manőver `NAV_CONFIG.thenWithinM` (5 km) belül van.
  - **Útvonalválasztó címke:** `altLabels` a saját (nem közös) szakaszt (`own`), a leágazást, és a két ritkított útvonalat adja;
    `placeAltLabel` (közös TS = Swift logika, képernyő-pontban): a (horgony, oldal) párok pontozása – soha nem takarja a leágazást
    (12 px) és a cél-jelölőt (40 px-es doboz), kifér a képernyőre, a legkevesebb vonalat takarja, a horgony minél messzebb a
    kiválasztottól (`6 · d`). Web: `map.project` a `move`/`moveend`-re; iOS: `proxy.map.points(for:)` a kamera-változásra.
  - **Beállítások:** a külön „Hang (hangos utasítások)” sor (`settings.voice`) törölve; a hang elérhetősége zárójelben a „Hangos
    utasítások” leírásának végén (`voiceInstructionsHint`; iOS-en `AVSpeechSynthesisVoice` szerint).
  - **Mérés-függvény (core, ellenőrizve):** „Maradj X alatt” = `requiredSpeed` (a hátralévő úton ennyivel a kapunál pontosan a
    határ az átlag), „várható” = `projectedAverageKmh` (a mostani sebességgel); a kettő nem mond ellent: várható ≤ határ ⇔ most ≤
    Maradj. Példa (137 átlag, 130 határ, most 108, 2,0 / 7 km): Maradj **115**, várható **127** – a kód eddig is ezt adta.
    Fixtúra: `straight7` szakasz + `straight7-137-108` vezetés (TS + Swift). A mérés határa mindig a szakaszé, a Mapbox-tábla csak
    a bal alsó táblát és a piros km/h-t vezérli.
- **AW18 (éles budapesti vezetés, Kristof 2026-10-30), weben és iOS-en:** a logika a `navigation/traffic.ts` /
  `Navigation/Traffic.swift` + `NavigationSession`, a küszöbök a `TRAFFIC`-ban (iOS-re generálva).
  - **Útvonalválasztó:** a „Leggyorsabb” címke és az előválasztás a legkisebb kártya-idejű útvonal (`fastestRouteIndex`,
    `routeTagText`), nem a Directions 0. indexe; az adat későbbi megérkezésekor újra, amíg nincs kézi választás (`userPicked`).
    A térképcímke (`altDeltaText(altS, selectedS)`) a két kártya kerekített perceiből számol (42 vs 41 → „−1 perc”).
  - **Élő forgalom:** a 2 perces `alternatives` lekérés egyben a forgalom-frissítés (látható ajánlat mellett is fut): ha a
    válaszban benne van a jelenlegi útvonal (`routeOverlap ≥ 0,9`), annak friss ideje adja a hátralévő időt a lekérés helyétől
    (`fresh`); ha nincs, egy `traffic` lekérés megy a következő manőverre tett néma köztes ponttal (`via`, `waypoints=0;2`,
    alternatíva nélkül – a Directions köztes ponttal nem ad alternatívát). Az újratervezés maga a friss lekérés. Új ajánlat
    továbbra is az AW12-szabállyal (≥ 2 perc, megéri / lehet / nem éri meg). A Directions-kliens 10 s után `timeout`.
  - **„+N perc dugó”:** a friss ETA (Mapbox / helyi dugó) − az indulási terv (`plannedEtaMs`, az első fixnél rögzítve) ≥ 3
    perc → borostyán pill az érkezési idő mellett (`delayMin`); csak friss adattal vagy dugóban (a puszta lassú haladás nem
    elég). Hang (`nav.voice.delay`, `VoiceKind` `traffic`) **csak az első alkalommal** (AW18-javítás, Kristof); a késés
    további növekedésénél a sáv némán frissül.
  - **Helyi dugó-érzékelés (`JamDetector`):** a 2 perces ablak átlaga (az útvonal menti legtávolabbi pont növekedéséből – a
    GPS-zaj nem haladás) a várt tempó (a Directions nyers ideje ±250 m-en) fele alatt → dugó; vége ≥ 500 m megszakítás
    nélkül a várt tempó 80%-a fölött (a lámpák közti rövid gyorsulás nem szakítja meg). Dugóba lépéskor „Dugóba kerültél?
    Igen / Nem” a manőverkártya alatt (`jamAsk`, 15 s), hang egyszer; Igen → „Dugó” bejelentés (a meglévő folyamat) +
    `bejelentett` minta, Nem → a szakaszra (a következő manőver helye a kulcs) nem kérdez újra. Dugóban az ETA a mért átlaggal (legalább 5 km/h) csak az útvonal előttünk lévő, a Directions
    congestion-annotációjában heavy/severe jelölt ÖSSZEFÜGGŐ szakaszára számít, legfeljebb `jamAheadMaxM` = 2 km-ig
    (**AW19 javítás 2** – eddig a következő manőverig, 3 km-ig; `jamAheadRun`, `jamExtraS`); congestion-adat nélkül (minden szakasz
    `unknown`) legfeljebb `jamNoDataMaxM` = 1 km, a tempó lineárisan megy át a tervezettbe (a lassulás fele). A dugó-állapot végén
    azonnal a tervezett idők. Az annotációt a friss forgalmi útvonalból vesszük, ha van. Példa: 7,5 km egyenes, az első 1,5 km dugós →
    az ETA legfeljebb ~1,5 km-nyi lassulással nő, nem duplázódik. A Mapbox és a helyi becslés közül a nagyobb.
  - **Bejelentés:** új típusok `dugo` (lassan halad) és `beallt` (áll), a menü utolsó sorában a kapu-tétel mellett
    (`isRowTile`; egy 4 oszlopos rács, 1 + 1 + 2), 6 nyelven (angolul „Traffic” / „Standstill”, hogy egy sorba férjen;
    AW18-javítás: németül „Messstrecke Start / Ende”, „Sperrung”, „Strecke fehlerhaft” – így minden nyelven minden csempe 76 px); a
    menüből küldött dugó / beállt is közösségi mintát ad (`reportedJam`); a kártya „Igen”-je egyetlen `bejelentett` mintát ad.
  - **Alsó sáv dugónál kétsoros:** a „+N perc dugó” az érkezési idő fölött (390 px-en mellé nem fér).
  - **Közösségi dugó-adat:** `jam_samples` tábla (migráció `20261030000100`, RLS mint a reports: olvasás mindenkinek, beszúrás
    a saját nevére, módosítás nincs, a `created_at` a szerveré) + `active_jams` nézet (15 percnél frissebb). Feltöltés:
    dugóba lépéskor és dugóban 2 percenként `erzekelt`, a végén `oldott`, bejelentésnél `bejelentett` (`drainJamSamples`).
    Olvasás percenként az útvonal előttünk lévő 30 km-ére (`jamQueryBBox`); a más felhasználótól származó, azonos irányú
    (±45°), friss minta az érintett szakasz (`length_m` a pont előtt) idejét a mért átlaggal írja felül, az újabb nyer
    (`applyCommunityJams`). Szimulátorban nincs feltöltés (csak `window.__navJam` / napló). Élőben migrálva 2026-10-30.
  - **Újratervezés-hiba:** automatikus próba 5 → 10 → 20 → 30 s (max 30) várakozással (`rerouteRetryDelayMs`), a kártya a
    hátralévő másodpercet mutatja (`rerouteRetryInS`, `nav.rerouteRetryIn`), koppintásra azonnal (`retryReroute`; az előző
    hívás után 5 s-on belül a korlát leteltekor). Az ok a konzolra: `[nav] reroute failed (http_503 | timeout | network |
    NoRoute), attempt N, retry in S s` (technikai napló, ékezet nélkül – a felirat-őrök miatt). Visszatérve az útvonalra a
    hiba-kártya eltűnik.
  - **Szimulátor:** `?navsim&traffic` / `-traffic YES` (dugó mód: az 1. ablak letérés nélkül 5,2 km-ig, 2,2–2,8 km között
    álló–induló araszolás, a friss lekérések `SIM_JAM` szerint +7 perccel, alternatíva nélkül; iOS: `navsim-traffic.json`),
    `?fasterAlt` / `-fasterAlt YES` (a 2. útvonal 1 perccel gyorsabb), `?rerouteFail` / `-rerouteFail YES` (az újratervezés
    HTTP 503). Az alap navsimben az M1-re visszatérő 50 km/h-s szakasz is dugónak számít (a terv ott ~110) – ez valós viselkedés.
- **AOS15 (2026-10-30), iOS (+ web a kamera-kártyánál):** képek: `apps/ios/docs/aos15-*.png` (a javításban + `aos15-reroute-fail.png`, `aos15-live-attribucio.png`). **nav-shots:** a teljes futás ~20 perc – háttérben futtasd (az előtérbeli 10 perces korlát csendben megszakítja, részleges számot adva). AW19 óta a `page.close()` a lapot is bezárja (a nyitva maradt lapok terhelték a gépet és nyitva tartották az IndexedDB-t), a CDP-hívásnak 180 s a korlátja, az AW19-blokk saját Chrome-ban fut; teszt-adatot tranzakcióval törölj, ne `deleteDatabase`-szel (nyitott kapcsolat mellett a mögé sorolt `open` örökre vár).
  - **CameraCard iOS-en** (a webes `CameraCard` 1:1, `UI/ReportViews.swift` `CameraCard`): kamera-jelölőre koppintva a bejelentés
    kártyájának helyén és stílusában – típus, út · limit (`cameraCardDetail`, a választott egységben), irány a haladásunkhoz
    képest + távolság (`cameraCardMeta`, `cameraDirection`: irány nélküli kamera → mindkét irány; álló autó → „egy irányban”;
    ±`CAMERA_CARD.sameDirDeg` = 90° → „a te irányodban”, generált), forrás pipával (`cameraSourceText`). Az irány és a
    távolság a **webre is** felkerült (közös TS + Swift logika, azonos nevű teszt). A kiválasztott jelölő 1,2×; a térkép üres
    részére koppintva (`onMapTapGesture` → `mapTapped`, a jelölő saját koppintása 0,4 s-ig nem zár) vagy X-re zárul – ez a
    bejelentés-kártyára is új iOS-en (a weben eddig is így volt); mérés közben 3 s után magától. A kamera-jelölő iOS-en is a
    DESIGN.md szerinti 32 pt-es lekerekített négyzet (eddig kör, ellenőrzöttnél piros gyűrűvel – paritás-hiba volt).
    Képernyőkép: `-cameraOpen <id>`.
  - **Live Activity a GPS indításától** (`LiveActivityController`, `liveActivityState(…, gps:)`): `start()` / `startSim()` indítja
    előtérben, a GPS végén (`exitSim`) zárul; ha a felhasználó elhúzza (`activityStateUpdates`
    → `.dismissed`), a következő GPS-indításig nem jön vissza. **AOS15-javítás:** a rendszer lezárása (`.ended`, 8 óra) után vagy ha hiányzik, az app előtérbe kerülésekor
    (`scenePhase` → `AppModel.appBecameActive` → `LiveActivityController.resume`) futó GPS-szel magától újraindul (`liveEndKind`). Öt állapot: figyel (`Watch`: sebesség, tábla – navigáció
    nélkül nincs tábla-adat, ezért üres –, „Szakasz X múlva” ≤ 5 km, `nextSectionAheadM`), navigáció (+ hátralévő idő · km,
    „+N perc dugó”), szakaszmérés (+ „Maradj X alatt” / „Lassíts · max X” / „Nem hozható be”), mérés + navigáció, kézi (+ eltelt
    idő). Számok ≤ 1 Hz és csak változáskor, „figyel” állapotban 0,5 Hz (`liveMinInterval`, AOS15-javítás); új térképkép azonnal.
  - **Térképkép** (`LiveActivity/LiveMap.swift`): **Mapbox Static Images API** (Kristof döntése a kör elején: a háttérben futó
    app GPU-t nem használhat, a Snapshotter zárolt képernyőnél nem renderelne), `dark-v11`, 120 pt @2x, menetirány felfelé,
    zoom 14 → 13 (50 → 110 km/h), az útvonal 300 m mögöttünk – 2,5 km előttünk, a közeli szakaszok és a mért szakasz
    (`path` átfedés, kódolt vonallánc, ritkítva). App Group: `group.hu.atlagsebesseg.app` (mindkét target entitlementje a
    `project.yml`-ben), két váltakozó fájl (`LiveMapStore`). Frissítés (`liveMapDue`): manőver / állapotváltás (a `key`)
    azonnal, különben ≥ 30 s és > 100 m mozgás; a kérés bélyege hibánál is rögzül (nincs ismétlés-vihar); 1500 m-nél
    messzebbi középpontú kép nem látszik (`liveMapShown`; 180 km/h × 30 s – kisebb küszöbnél autópályán a kép az idő felében
    eltűnne). A szakaszok geometriája a kép 2,5 km-es környékére vágva (az URL ≤ 8192 karakter). Logó és attribúció a képen nincs (`logo=false&attribution=false`); helyette a lezárt képernyős nézet alján
    8 pt halvány „© Mapbox © OpenStreetMap” (`ios.live.attribution`, `ContentState.attribution`, csak kép mellett; a Dynamic
    Islandben nincs) – Kristof döntése (AOS15-javítás). Token nélkül vagy App Group
    nélkül nincs kép, a tartalom teljes szélességű.
  - **Koppintás:** `widgetURL` `atlagsebesseg://live/measure|nav|map` (`CFBundleURLTypes`), `AppModel.openLink`: a lapok, a
    keresés (mérés / navigáció közben) és a kártyák bezárulnak, a térkép újra követ.
  - **AW18-paritás (iOS-javítások, az ellenőrzés után):** a „+N perc dugó” kapszula 1 × 10 pt belső margó, 4 pt sorköz (mint a
    webes rács); a „Dugóba kerültél?” gombjai bejelentés küldése közben tiltva; az önálló dugó-kártyát a közeli kamera nem
    rejti el; a menüből küldött Dugó / Beállt közösségi mintája csak sikeres küldés után (`reportedJam`); az újratervezés
    kártyája közben borostyán, title-méret, forgó ikon, hibánál piros 22 pt, a visszaszámlálás 17 pt; a „Leggyorsabb” /
    „Alternatíva” címke mindig accent, 16 / 620. **AOS15-javítás:** a technikai napló hibaszövege a webével egyezik
    (`routeErrorKind`: `URLError` → `network` – a webes `TypeError` párja, a `URLError(.timedOut)` is –, a kliens saját
    időtúllépése `timeout`, más hiba `network: <üzenet>`); sáv-módban a rejtett felső kártya a bejelentéssel és a
    dugó-kérdéssel együtt mért (mint a weben), így nem villog vissza a teljes kártya.
  - Szimulátor: `-manual 0` navigáció nélkül is (kézi mérés indul); az előnézet (`-livePreview YES`) az `AppModel.liveState`-et
    rajzolja – benne a valódi (letöltött) térképképpel.
- **AW19 (2026-11-02), weben és iOS-en: krúzing mód, utak naplója, statisztika.** Logika: `packages/app-logic/src/trips.ts` ↔
  `Logic/Trips.swift` (`TripRecorder`, `TurnDetector`, `simplifyPath`, `tripTotals`, feliratok), tesztek `trips.test.ts` ↔
  `TripTests.swift` azonos nevekkel; a küszöbök a `TRIP`-ben (iOS-re generálva).
  - **Út:** cél nélkül is – ≥ 10 km/h legalább 30 s → indul (a kezdete e mozgás eleje); 5 perc állás fixekkel (< 5 km/h; a záró
    állás nem része, a vége az utolsó mozgó minta) vagy a felhasználó megállítása (`stop()`: iOS `stopSource`, a szimuláció vége)
    zárja; 200 m alatt eldobjuk (a mintáival). **Javítás 2 (2026-11-02):** a háttérbe kerülés, a GPS-kiesés, az engedély-vesztés
    és az appváltás NEM zárja az utat és NEM állítja le a navigációt (a webes `visibilitychange` / `pagehide` már nem hívja a
    `stop()`-ot; csak a szakaszmérés szakad meg, mint eddig). Fix nélküli rés (> `stopIdleS` = 5 perc) után az első új fix dönt:
    az utolsó helytől > `resumeNewTripM` = 500 m → a régi út lezárul (vége az utolsó mozgó minta), új indul; különben UGYANAZ az
    út folytatódik (`resume`: a kieső idő állásidő, a rés nem táv, új útvonal-darab, a kanyar-felismerés újraindul). A csend
    magában (tick) sosem zár. **Pillanatkép** (`snapshot()`, `checkpointS` = 60 s-enként és háttérbe kerüléskor → a napló
    `put`/`INSERT OR REPLACE`): a futó út nyitva marad, de ha az app a háttérben leáll, az eddigi út nem vész el (újraindítás után
    nem folytatódik, új út indul). Navigáció és szakaszmérés **ugyanabba** az
    útba: a cél neve (az utolsó), újratervezések (a `rerouting` felfutó éle), dugóidő (a `jam` állapot), szakaszmérések (a
    `befejezve` eredmény, `overLimit` = túl gyors). Távolság csak mozgó, ≤ 50 m pontosságú mintából; > 250 km/h-s ugrás nem táv,
    az útvonal új darabot kezd (a navsim ablakai). **Két számláló (javítás 2):** „Kanyarok” (`turns`, B/J/U) kizárólag a navigáció manővereiből –
    `noteNextManeuver(icon, instruction, distanceM)` minden nézet-frissítéskor; ha a következő manőver kicserélődik és az előző
    `maneuverPassM` = 80 m-en belül volt, teljesítettnek számít (`maneuverTurnKind`: left / sharp_left / roundabout_left → B,
    right / sharp_right / roundabout_right → J, uturn → U; enyhe, egyenes, fork, merge, arrive nem kanyar; távoli csere = újratervezés
    nem számít); krúzingban 0. „Irányváltások” (`dirChanges`, B/J/U) GPS-alapú, mindig számol (`TurnDetector`: ≥ 60° irányváltás
    5 s alatt indítja, vége ha 3 s-ig < 15°; a nettó irányváltás dönt: ≥ 150° megfordulás, < 45° semmi – S-kanyar). A régi (AW19
    első változat) rekord `turns`-e GPS-es volt: olvasáskor `normalizeTrip` (web) / a `Trip` dekódere (iOS) → `dirChanges`, a kanyar 0.
    Napló lista (3. sor: „N kanyar · M irányváltás”, `trips.rowTurns`), részlet és statisztika-kártya mindkettőt mutatja, a kanyar
    az elsődleges (előbb áll). Útvonal: Douglas–Peucker 10 m, [lat, lon] 6 tizedes.
  - **Tárolás (csak helyben, szerverre semmi; az AW18 dugó-minták változatlanok):**
    - web: IndexedDB `atlagsebesseg-trips` v1 (`apps/web/src/trips/tripStore.ts`) – `trips` (kulcs `id`, index `startedAt`; a
      közös `Trip` alakja) és `samples` (automatikus kulcs, index `tripId`; `TripSample`: `tripId, t, lat, lon, speedKmh, heading,
      accuracy, h3`). A minták 1 Hz-cel, fixenként egy tranzakcióban, sorrendtartó láncon (`useTrips`).
    - iOS: rendszer-SQLite (`libsqlite3`, külső függőség nélkül; `Trips/TripStore.swift`, Application Support/`trips.sqlite`,
      WAL, `user_version` 1): `trips(id TEXT PK, started_at REAL, ended_at REAL, record TEXT)` – a rekord JSON-ban, a webes
      alakkal –, index `started_at`; `samples(trip_id, t, lat, lon, speed_kmh, heading, accuracy, h3)`, index `(trip_id, t)`.
    - **H3 (res 10)** minden mintán, előre számolva a következő kör hőtérképéhez: web `h3-js` 4.5.0 (lustán töltve, külön
      chunk), iOS `SwiftyH3` 0.6.0 (SPM, a H3 C-könyvtárát csomagolja); páros teszt ugyanarra a cellára.
    - Tárhely: ~3600 minta / vezetési óra – iOS ~0,45 MB/óra (mérve: 3600 sor 460 KB, SQLite-sor + index); web ~2,8 MB/óra
      (a Chrome `storage.estimate()` szerint 793 minta 622 KB-ot foglal, ez a tömörítetlen naplóval és a rekorddal együtt felső
      becslés, 793 mintából felszorozva); a rekord az egyszerűsített útvonallal ~5–40 KB / út.
  - **UI:** az üres nézet köszöntése alatt halvány „Krúzing · 12,4 km · 23 perc” (`cruiseStatusText`); iOS Live Activity „figyel”
    állapota ugyanezt mutatja (`Watch.cruise`). Beállítások › „Utak naplója” (a Mentett helyek fölött) → összesítő kártya
    (ez a hét hétfőtől / hónap / összes – `periodStart`, a készülék időzónájában), lista, részlet kis térképpel (Visszafogott),
    törlés (web: hosszú nyomás / balra húzás; iOS: swipe / helyi menü), „Összes törlése” megerősítéssel.
  - **Szimulátor:** `?cruise` / `-cruise YES` (a navsim-vezetés cél nélkül, rögtön indul); a lejátszás vége a GPS leállása (az út
    a naplóba kerül). A navsim teljes vezetése: `SIM_TRIP` (17 677 m, 792 s, kanyar 0 – a felvevő csak fixeket kap –, irányváltás B 1 · J 3 · U 0, 3 darab, 793 minta) – `navSim.test.ts`
    ↔ `SimTests.swift`, és a nav-shots a böngészőben az IndexedDB-ből méri. Képernyőkép: `?sheet=trips[&tripOpen=first]` /
    `-settingsOpen trips [-tripOpen first [-tripScroll YES]]` (a `-tripScroll` a számok sorát legalulra görgeti, hogy a két számláló látsszon; képek: `apps/ios/docs/aw19-javitas2-*.png`; navsim-vezetés `-simSpeed 40`-nel végigjátszva, majd újraindítva).
- **AW20 (2026-11-02), weben és iOS-en: hőtérkép, közösségi adatmegosztás, színezett út.** Logika: `packages/app-logic/src/heat.ts` ↔
  `Logic/Heat.swift` (és `heatSeed.ts` ↔ `HeatSeed.swift`), tesztek `heat.test.ts` ↔ `HeatTests.swift` azonos nevekkel; konstansok: `HEAT`,
  `SPEED_TONE` (iOS-re generálva). A H3-műveletek (középpont, szülő) függvényként jönnek be (web: h3-js, iOS: SwiftyH3).
  - **Személyes hőtérkép (csak helyben):** az AW19 res-10 mintáiból cellánként `HeatCell` {h3, count, avgKmh, lastT}; egy áthaladás = egymás
    utáni, azonos cellájú, mozgó (≥ 5 km/h) minták (`tripPasses`). **Inkrementális:** minden út végén egyszer (`absorbTrip` / iOS `TripStore`,
    egy tranzakcióban, idempotens a `heatTrips` / `heat_trips` jelölővel), indításkor a még be nem olvasztott utak (pl. a háttérben leállt
    app pillanatképe) visszamenőleg; rajzoláskor nem számol újra (`HeatIndex`: középpont- és res-8 gyorsítótár). Az út törlése a
    hőtérképből NEM von vissza; az „Összes törlése” törli. Tárolás: web IndexedDB v2 (`heat`, `heatTrips`), iOS SQLite `user_version` 2
    (`heat`, `heat_trips`, `samples.limit_kmh`).
  - **Megjelenítés:** Mapbox heatmap réteg, módok „Gyakoriság” (súly `log(1+n)/log(21)`) és „Átlagsebesség” (átlag/130); színskála a
    `heatFreq*` / `heatSpeed*` tokenekből (DESIGN.md). Beállítások › „Hőtérkép: ki / saját / közösségi” (`hoterkep`, alap saját), a mód
    (`hoterkep_nezet`) a térképen üveg-szegmens + jelmagyarázat. **Csak az üres nézeten és krúzingban** (nincs navigáció / útvonalválasztó /
    szakasz- vagy kézi mérés). **Zoom:** 12,5 fölött res 10, alatta res 8; ha a látható rész > `maxFeatures` = 4000 pont, res 8; csak a
    látható téglalap (+25%) kerül a rétegre.
  - **Közösségi (AOS17-től alapból BE, egyszeri migrációval, lásd lent):** Beállítások › „Névtelen vezetési adatok megosztása” (`adatmegosztas`). Bekapcsolva az út végén
    `uploadRows`: (cella, óra, hét napja) szerint összevont {h3, h3_r8, lat, lon, count, avg_speed, hour, dow} → feltöltési sor (web
    localStorage / iOS UserDefaults `heat:outbox:v1`, ≤ 2000 sor) → `heat_cells`. **Az út első és utolsó 300 m-ének cellái sosem mennek
    fel** (a védett cella MINDEN áthaladása kimarad, `endCells`). Kikapcsoláskor a várakozó sor törlődik; a már beolvasztott régi utak
    visszamenőleg nem töltődnek fel; szimulátorban nincs feltöltés. Olvasás: `heat_global` (res 10) / `heat_global_r8` a látható
    téglalapra (`heatQueryBox`, 10 perc gyorsítótár, ≤ 5000 cella). Migráció `20261102000000_heat_cells.sql` (élőben lefuttatva
    2026-11-02, SQL-teszt `heat_cells_test.sql`): a tábla senkinek nem olvasható, csak az aggregált nézetek (≥ 3 beküldésű cella).
  - **Út színezése:** a napló-részlet kis térképén a vonal a mért sebesség szerint (`speedRuns`, 12 fokozat): zöld–sárga–piros a
    tábla-limithez képest (≤ 90% / limit / ≥ 115%), ismeretlen limitnél abszolút (50 / 90 / 130 km/h). A `TripSample` új `limitKmh`
    mezője (a navigáció tábla-limitje, `TripRecorder.setLimit`); régi minta / út: abszolút skála, minta nélkül az egyszínű vonal.
  - **Háttér (iOS):** a `location` háttér-mód, `allowsBackgroundLocationUpdates` és `CLBackgroundActivitySession` megvolt; háttérbe
    kerüléskor semmi nem állítja le a mérést / navigációt (AppTests őr védi). Weben a böngésző-korlát marad: a háttérlap GPS-e
    felfüggesztődik (a szakaszmérés megszakad, az AW19 szerint az út és a navigáció nem zárul).
  - **Szimulátor:** `?heatSeed` / `-heatSeed YES` (determinisztikus, 12 „utas”, M1 + budapesti körök; közösségi módban is ebből, hálózat
    nélkül), `?heat=ki|sajat|kozossegi`, `?heatView=…` / `-heat`, `-heatView`, `-settingsOpen heat`; webes teszt-kampó `window.__mapJump`
    (csak teszt / heatSeed módban). nav-shots: 177/177.
  - **AW20-javítás – adatvédelmi zónák (Strava-minta), weben és iOS-en:** minden mentett hely (Haza, Munka, további) körül zóna, alapból
    500 m, helyenként 200 m / 500 m / 1 km (`ZONE_RADII`, `heatZones(saved, zona_m)`, `inZone`: a cella középpontja a sugár + 70 m-en belül;
    res 8-on a normál és a zónás cellák külön összevonva). A beállítás `zona_m` (`hely-azonosító → m`, `home` / `work` / további hely
    azonosítója) a Beállításokkal együtt, csak helyben tárolódik. **A zónában lévő cellák sosem mennek fel** (`uploadRows(…, zones)`:
    a cella MINDEN áthaladása kimarad; a 300 m-es út-vég védelem mellette marad), és a saját hőtérképen **szürkén, nem színezve** látszanak
    (`HeatIndex.points().grey`, token `heatGrey`; közösségi módban nincs szürke). A zónák halvány körei (accent ~10% kitöltés, ~45%
    vonal) csak amíg a Beállítások vagy a Részletek lap nyitva van; sugarat váltva a kamera a zónára áll. A mentett helyek és a zónák
    SEMMILYEN hálózati hívásba nem kerülnek (`heatUpload.test.ts` / AppTests-őr: a kérés kulcsai pontosan a `heat_cells` 8 oszlopa).
  - **Kommunikáció (6 nyelv):** a „Névtelen vezetési adatok megosztása” alatti leírás (`settings.shareHint`): mi megy fel (cella,
    áthaladás-szám, átlagsebesség, óra-sáv, hét napja), mi nem (útvonal, pontos idő, azonosító, mentett helyek környéke, utak eleje /
    vége); „Részletek” sor (`settings.shareDetails`) → lap (`heat.details.*`: Ami felmegy / Ami nem megy fel / Védett zónák) a zónák
    helyenkénti beállításával. Szimulátor: web `?sheet=settings|heatDetails`, `window.__mapJump`; iOS `-simPlaces YES`, `-mapZoom`,
    `-mapLat`, `-mapLon`, `-settingsOpen heatDetails`, `-settingsDetent medium`.
  - **iOS-javítás:** a `TripStore` user_version 2 migrációja minden indításnál újra lefutott (`duplicate column name: limit_kmh`), mert az
    `ALTER` hibája miatt a verzió nem állt át – most csak hiányzó oszlopnál fut, és a verziót külön lépésben állítja.
- **AOS16 (2026-11-03), paritás-audit AW17–AW20, iOS a web szerint:** gombsor jobbra zárva, a tábla és a „Vissza a helyemre” külön sorban (AOS18-javítás óta a „Vissza a helyemre” a gombsor jobb szélén, a tábla marad; AW21 óta a gombnak saját, MINDIG fenntartott helye van – `.recenter-slot`, rejtve üres, a Bejelentés stb. nem mozdul), Beállítások +
  stopper a webes feltétellel (`!driving`, nem kézi eredmény); a tábla befejezve / megszakadt / kézi eredmény alatt is; kompakt ajánlatnál a pillek és
  a gombsor maradnak; hőtérkép: `kozeledik` alatt rejtve, a módváltó felül a krúzing-sor alatt és csak kész rétegnél (`heatReady`), webes rétegértékek,
  közösségi lekérés csak látható rétegnél, módváltáskor is, 10 perc után újra; a feltöltési sor a megosztás kikapcsolásakor és induláskor törlődik;
  „Összes törlése” a kirajzolt hőtérképet is üríti (web is); a Részletek lap „Haza” / „Munka” a szótárból; a napló alatt nincs zóna-kör; Beállítások
  sorrend; napló-térkép címkék; csempeméretek; követő kamera mérés közben 5 s után vissza (`Logic/Follow.swift`, a `followReducer` párja); offline pill;
  szakasz-kiemelés csak mérés / közeledés alatt; háromjegyű sebesség egy sorban. **Web:** zónára álláskor kikapcsol a követés (`useFollow.release`), az
  útvonalválasztóban nincs kereső-gomb és köszöntés. **Live Activity:** a lezárt képernyő és a kibontott Island mind az öt állapotban ≤ 160 pt
  (`LiveActivityTests`), Islanden a krúzing-sor a következő szakasz mellett is; `-liveGallery figyel|nav|meres|meresnav|kezi` (mintaadat, csak `-livePreview` mellett).
- **AOS17 (2026-11-03), dizájn-paritás az első TestFlight-teszt alapján, web + iOS:**
  - **Jelölőszín (Kristof döntése):** az `accent` `#2EE59D`, csak kapcsoló, jelölőnégyzet, kiválasztott útvonal, fókusz; a kiválasztott szegmens fehér, mint a weben; a kézi mód, a Rendőrség-ikon és a többi korábbi `accent`-hely az új `brand` tokenen (`#7A86FF`) maradt. iOS: `UI/SettingsControls.swift` (`ListCard`, `RowText`, `ToggleRow`, `SwitchStyle`, `Segmented`, `MiniButtonStyle`, `CheckRow`), a Beállítások `Form` helyett ezekből, a webes sorrendben; rendszer-kapcsoló és UIKit-szegmens ott nem kerülhet vissza (AppTests-őr).
  - **Kezdőképernyő:** `StartView` a webes `.start`; cím `lineLimit(1)` + `minimumScaleFactor`, weben `white-space: nowrap` + mért betűméret (a német cím eddig levágódott). A 3. tipp platformfüggő: `ios.start.tip.background` / `start.tip.foreground`.
  - **Kamera:** a nem-navigációs követés a webes (`idleFollowZoom`: 17,3 → 15,5, dőlés 60°, a pozíció a webes `setFocusY` szerint); az első fixre ugrik, a kiinduló nézet a webes (46,5 / 12,5, zoom 5,2).
  - **Megosztás:** `adatmegosztas` alapból BE; egyszeri migráció: az `adatmegosztas_v2` jelölő nélküli tárolt érték BE-re vált, utána a felhasználó választása marad.
  - **Bejelentés:** A5-ös csempeméret (DESIGN.md), iOS-en `.height` detent a tartalomhoz (9 tétel 76 pt-vel nem fér a szigorú félmagasságba). „Térképhiba” (`szakasz_hiba`) → második választó, `MAP_ERROR_KINDS` / `MapErrorKind`, a sor `reports.subtype`-pal, az első koppintáskori helyről. Migráció: `20261103000000_reports_subtype.sql`, teszt: `reports_subtype_test.sql`.
  - **Live Activity „figyel”:** térképkép `streets-v12` + `liveMapGrade` (CPU, `LIVE_MAP_PALETTE`), mert a Static Images API a Standardot 400-zal elutasítja (`Unsupported rasterarray tileset`, 2026-11-03-án mérve); a paletta a Színes alapnézet (`dusk`, Kristof döntése) mért színei, a valódi `dawn` világos barackszínű; mind az öt állapotban ez a kép. A rárajzolt vonalak színei önmagukra képződnek. Krúzing: `cruiseFiguresText`, `cruiseDirChangesText`; `-liveGallery figyel`.
  - **Összes törlése:** `deleteAll(heat:keep:)`; `keep`: a sorok a kukába (web: `trashTrips`, `trashHeat`, `trashHeatTrips`, IndexedDB v3; iOS: `trash_*`, `user_version` 3), a minták a helyükön, 30 nap után törlődnek (`purgeTrash` indításkor és a Beállítások megnyitásakor); pipa nélkül azonnal, a korábbi kukával együtt. Visszaállítás: Beállítások › „Törölt adatok visszaállítása”, a cellák a törlés óta keletkezettekkel összevonva (`mergeHeatCells`). iOS-képhez: `-tripOpen deleteAll`.
- **AW22 (2026-11-04), web + iOS: fiók, Veszély, AW21-utómunka.** Logika: `packages/app-logic/src/account.ts` ↔ `Logic/Account.swift`, tesztek `account.test.ts` ↔ `AccountTests.swift` azonos nevekkel; kötés: `apps/web/src/hooks/useAccount.ts` ↔ `App/AppModel+Account.swift`; UI: `AccountCard.tsx` ↔ `UI/AccountViews.swift`.
  - **Bejelentkezés:** nem kötelező, indításkor nem kér. Apple (iOS: natív `ASAuthorization` + `signInWithIdToken` / `linkIdentityWithIdToken`, web: OAuth), Google (mindkettő rendszer-lap / redirect), e-mail: **magic link, jelszó nincs** (Kristof pontosítása; a jelszó-visszaállítás és -tárolás nyűgje nélkül). Nem kérünk születési dátumot, kort, telefonszámot. Az Apple-gomb saját felirattal a hivatalos fehér stílusban (`appleButton` token): a rendszer-gomb a készülék nyelvén írna, az app nyelve eltérhet. Be nem állított szolgáltató: `/auth/v1/settings` szerint tiltott gomb + felirat, nem hiba.
  - **Névtelen → fiók:** ugyanaz a felhasználó alakul át (`linkIdentity`, e-mailnél `updateUser`), az azonosító marad, minden sora megvan. **Már létező fiók:** a névtelen munkamenet egyszer használható igazolást kér (`account_merge_prepare`), belépés után a fiók beváltja (`account_merge_claim`): bejelentés, szavazat (ütközésnél a fióké, a számláló helyes), dugó-minta, közösségi szakasz átkerül, a névtelen auth-felhasználó törlődik. Az igazolás helyben: `account:merge:v1`. Valódivá vált felhasználó nem olvasztható be. A `report_votes_count` trigger `update of confirm`: a szavazat átvitele nem számol újra és nem hosszabbít.
  - **Táblák (`20261104000100_fiok.sql`):** `profiles` (Megszólítás + `megszolitas_ms`, a szolgáltató neve – az Apple csak egyszer adja, üressel nem írható felül –, `name_prompted`), `account_fields` (kulcsonként érték + `updated_ms`, a régebbi írást trigger dobja), `cloud_trips`, `cloud_heat`; RLS: csak a saját és csak valódi fiók (`is_real_account()`). Az **`updated_ms` `bigint`: iOS-en tört ezredmásodperc elutasított kérést ad (`accountNowMs`).**
  - **Szinkron (mezőnként a legutóbb módosított nyer, azonos időnél a szerveré):** beállítások (`settings.*`; a platform-specifikust a másik nem bántja), `lang`, `megszolitas` (a szerveren a `profiles`-ban), `place.home/work/other.<id>`, `zone.<id>` (törlés = `null` jelölő), `recents` (a lista egyesül, nem nyer). Idő: `noteLocalFields` névtelenül is vezeti (`account:fields:v1`), első felvételkor 0. Indul: belépéskor, változás után 2,5 s-mal, előtérbe kerüléskor.
  - **Felhős mentés (`felho_mentes`, alapból KI, fiókszintű):** az út egyszer megy fel (a futó nem), a minták 5 s-enként ritkítva (`CLOUD_SAMPLE_STEP_S`, a készüléken 1 Hz marad). **Saját hőtérkép készülékenként egy sor** (`cloud_heat`, teljes csere, csak ha az ujjlenyomat változott): a készülék a sajátját írja, a többit a `remoteHeat` / `remote_heat` tárba teszi és csak kirajzoláskor adja hozzá, így a számláló nem duplázódik; a letöltött út ezért nem olvad be újra (`heat_trips` jelölő). Törlés: `pendingDeletes`, a szerveren jelölő marad tartalom nélkül; visszaállítás: `pendingRestores`; hőtérkép törlése minden készülék sorát viszi. Kikapcsolva nem megy fel több adat, a meglévő másolat a fiók törléséig marad (a felirat kimondja).
  - **Kijelentkezés / fiók törlése:** új névtelen felhasználó, a helyi adatok maradnak; a `felho_mentes` helyben KI, de 0 idővel, így a fiók értéke nem íródik felül. Törlés: `account-delete` edge function (a saját JWT-ből a felhasználó, service_role töröl, a sorok kulcson esnek; névtelen 403); a közösségi cellák nem köthetők senkihez, maradnak.
  - **„Így szólítsunk?”** első belépés után, ha se helyben, se a profilban nincs Megszólítás és nem hagyták ki; Apple/Google keresztnévvel, e-mailnél üresen. **Út utáni ajánlat:** névtelenül, befejezett út után, legfeljebb 30 naponta (`account:nudge:v1`), csak az üres nézeten.
  - **Veszély:** az `akadaly` enum-érték marad, csak a felirat új; altípus a `reports.subtype`-ban (`targy`, `katyu`, `allo_jarmu`), a régi sor altípus nélkül „Veszély”. Bemondás bejelentésenként egyszer (`hazardVoice`).
  - **„Vissza a helyemre” + ManualMini:** a mini helye nem mozdul (az AW21 előtti); amíg látszik, nincs `.recenter-slot`, a gomb a jobb oldali gombsor fölé kerül (`.recenter-above`; spec: `recenter-mini`).
  - **Térképfeliratok az app nyelvén:** web `map.setLanguage`; iOS `MapLanguageInterceptor` (`language` paraméter a `/v4/` kérésekre, mert a Standard stílusnak nincs nyelv-beállítása és a `localizeLabels` nem hat rá). Nyelvváltáskor és eltérő indulási nyelvnél `MapboxMap.clearData` + a térkép újraépül (`map:lang:v1`): a régi nyelvű csempék a gyorsítótárból jönnének. Az interceptor **`nonisolated`**: a Mapbox a saját szálán hívja (MainActor alatt azonnali crash).
  - **Próbák:** `npm run db:live` (`account_test.sql`), `npm run db:account-live` (32 ellenőrzés valódi GoTrue + RLS + edge function, levél nélkül), `node apps/web/scripts/account-e2e.mjs` (böngésző, 17 ellenőrzés). A küldés gombot próbában ne nyomd meg: a beépített levelező korlátja 2 levél / óra. iOS-en DEBUG-ban `-debugUrls YES` + `Documents/debug-url.txt` (a `simctl openurl` rendszer-párbeszédet nyit, koppintani nem tudunk); az admin-link implicit munkamenetét csak DEBUG fogadja el. Képek: `-accountSim in|off|sent`, `-nameStep X`, `-nudge YES`, `-reportHazard YES`, `-manualMini YES` (web: `?account=`, `?nameStep=`, `?nudge`). Apple-titok: `supabase/scripts/apple-client-secret.mjs`.
- **AW23 (2026-11-05, Kristof éles iPhone 16 Pro Max-tesztje), web + iOS:**
  - **Jelölő és kamera:** `positionSmoother.ts` ↔ `Logic/PositionSmoother.swift` (azonos nevű tesztek, közös valódi nyomat: `packages/app-logic/src/fixtures/gps-trace-1hz.json`, OSM nyilvános GPS-nyomok). A fixek között sebesség + irány szerint halad, új fixnél korlátozott tempóval áll rá (menetirányban 0,5–1,5 × v, oldalt ≤ 0,5 × v), > 80 m-nél ugrik, GPS-kiesésnél 1,5 s után megáll. iOS: `Map/FollowDriver.swift` (`CADisplayLink`: a kamera `setCamera`-val, a jelölő `PuckOverlay`-ben, nem annotáció); web: `MapController.frame`. Mérés: `npm run aw23:check -w @atlagsebesseg/web -- frames`, iOS `-gpsTrace 0 -frameLog YES` (csak DEBUG, `Documents/frames.json`).
  - **Egy kamera-logika minden állapotra:** `followZoom`, `followFocusY`, tokenek: `camera` (`packages/design-tokens`, iOS `Tokens.Camera`): dőlés 58°, a jelölő a legfelső alsó kártya fölött 56 pt-tel, 0,18–0,8 között; a `NAV_FOLLOW` és az `idleFollow*` megszűnt.
  - **Dugó (`JamDetector`, `traffic.ts` ↔ `Traffic.swift`):** a viszonyítás a MEGENGEDETT sebesség (`permittedKmhAt`: tábla, különben útkategória alapértelmezése, `DEFAULT_LIMIT_KMH`). Belépés: 3 perc „érvényes” idő átlaga a megengedett 40%-a alatt, és az ablak előtt már haladtunk. Lámpa-türelem: nem autópálya-jellegű úton (`highwayAt`) a lámpa / kereszteződés / kanyar 60 m-en belül (`stopPointsM`, a Directions `intersections`-ből) a megállás első 2 perce nem számít. Vége: tartósan a megengedett 70%-a fölött (városban ≥ 1 km és 2 perc, autópályán ≥ 3 km és 3 perc); az ETA-korrekció (`correcting`) addig él, amíg a hátralévő úton heavy / severe van. „Nem” válasz: az állapot törlődik, 10 percig nincs újabb kérdés.
  - **„+N perc dugó” (`routeDelayS`):** EGY számítás az útvonalválasztónak és a navigációnak, a hátralévő út congestion-adatából; heavy / severe nélkül 0, legfeljebb a hátralévő idő fele. A térkép a `NavView.trafficRoute`-ot rajzolja (a friss válasz), így felirat térképi szakasz nélkül nem lehet. A régi `plannedEtaMs` (az indulási tervhez mért késés) megszűnt: ez adott +5 percet üres úton.
  - **Krúzing (`trips.ts`):** küszöbök 15 km/h × 30 s, ±30 m (eddig 10 km/h, ±50 m); alatta szünetel, a kijelzett idő a mozgó idő. A navigált út külön út: a `setDestination` kezdete és vége lezárja a futó utat.
  - **Gombsor (végleges):** alsó sor jobbra zárva (Beállítás, Stopper, Bejelentés), fenntartott hely nélkül; fölötte a `.actions-upper` (iOS `upperRow`): tábla balra, ManualMini, a „Vissza a helyemre” helye pontosan a Bejelentés fölött. A lebegő kártyák e sor fölött. Mérés: `npm run aw23:check -w @atlagsebesseg/web -- actions`, paritás-állapotok `mini-*`. `?miniAlways` / `-miniAlways YES`: a mini navigáció nélkül, csak a méréshez.
  - **Útvonal-panel:** az alsó sávra koppintva (`NavPanel.tsx` ↔ `NavRoutePanel`), `routeTimeline`, `requestAlternatives`, `useRoute`; a navigáció közben nem áll le.
  - **Keresés:** Search Box (`searchbox.ts` ↔ `SearchBox.swift`): `/suggest` + `/retrieve`, `SearchSession` (egy nyitott keresés egy munkamenet), `Place.retrieveId`, a találat koordinátája választáskor jön. A Geocoding marad a koordinátából címre. Élő próba: `npx tsx apps/web/scripts/searchbox-live.mts`.
  - **E-mail:** `authEmails.ts` (sablonok 6 nyelven, `.Data.lang` a felhasználó metaadatából), `supabase/scripts/setup-resend.mts` (`domain|verify|smtp|templates`), kulcs: gitignore-olt `.env.resend`.
  - **Élesedés:** a lapon `<meta name="build-sha">`; a service worker visszatéréskor frissít, és az új verzióra újratölt, ha nincs navigáció vagy mérés (`sw/register.ts`).
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
  `-geoHelp YES` (a tiltott-lap a képernyőképhez). AW17: `-navPick N` (az útvonalválasztóban az N. útvonal kiválasztva),
  `-settingsOpen voice` (a Beállítások a hangos utasításoknál).

## TestFlight (AOS16)
- **Parancs:** `npm run ios:testflight` (build-szám +1, archive, feltöltés az Xcode Apple ID-jával); `-- --no-upload`: próba, számnövelés és
  feltöltés nélkül; `ASC_KEY_ID` + `ASC_ISSUER_ID` (+ `ASC_KEY_PATH`): API-kulcsos mód. Napló: `apps/ios/build/testflight/<verzió>-<build>/`.
- **Beállítások:** Team ID a gitignore-olt `Secrets.xcconfig`-ban (`DEVELOPMENT_TEAM`, az `npm run secrets` megtartja); a `project.yml`-ben
  automatikus aláírás, egy helyen a `MARKETING_VERSION` és a `CURRENT_PROJECT_VERSION` (az Info.plist ezekből; mindkét target). Csak `generic/platform=iOS`.
- **Miért aláírás nélküli az archive:** az automatikus aláírás archive-kor fejlesztői profilt kérne, ahhoz regisztrált eszköz kell, kézi disztribúciós
  identitást pedig nem fogad el. Ezért `CODE_SIGNING_ALLOWED=NO`, utána ad-hoc `codesign` az entitlementekkel, a végleges aláírást az export adja.
  Valódi iPhone-ra futtatáshoz (Debug) az eszközt egyszer csatlakoztatni kell, az Xcode ekkor regisztrálja.
- **Képességek:** App Group `group.hu.atlagsebesseg.app` mindkét target entitlementjében; Location background és Live Activities az Info.plist-ben
  (`UIBackgroundModes`, `NSSupportsLiveActivities`), nem entitlement. Az `ITSAppUsesNonExemptEncryption: false` miatt az export compliance kérdés nem jön.
- **Ikon:** nem lehet alfa-csatornája (RGB PNG), különben a feltöltést elutasítják.
- **Nyitott (2026-11-03):** az első feltöltés `App Store Connect Credentials Error` (`Actor/relationships/providerId`) hibával állt meg, kézi teendő:
  `apps/ios/README.md` › TestFlight. A Beállítások szimulátor-sora Release-ben is megvan, és a szimulátor az éles Supabase-re küld bejelentést (AOS14):
  külső tesztelők előtt le kell zárni.

## Web–iOS paritás (Kristof, 2026-10-30)
- **A web a referencia:** minden webes funkció iOS-re is megy ugyanabban vagy a következő AOS-körben, kivéve a platformspecifikusat
  (CarPlay, Live Activity, böngésző-engedély és hasonló). Paritás-hiány = **tartozás**: a CLAUDE.md-ben jelöljük, és a
  zárójelentésben felsoroljuk, amíg nem zárul.

## Paritás-harness (AOS18, Kristof, 2026-11-03)
- **Új iOS-UI csak a webes komponens fájl-hivatkozásával és spec-jével** készül: a nézet kommentje nevezze meg a webes elemet (`styles.css` osztály / `apps/web/src/ui/*.tsx`), a `docs/parity/specs/<komponens>.json` tartalmazza (`packages/parity/scripts/specs.mjs` lista, `npm run parity:specs`), és az `AtlagsebessegTests/ParityTests.swift` assertáljon rá.
- **SwiftUI-alapértelmezés tilos:** rendszer-árnyék (`.shadow` helyett `BoxShadow`, a `Tokens.Shadow`-ból), alap Mapbox puck (`Puck`), natív segmented picker (`Segmented`), alap Button-stílus, rendszer-betű (`.css` / `.inter`), rendszer-sheet a vezetési nézet lapjainál (`AppSheet`). A CSS `border` a dobozhoz adódik (`Glass`: 1 pt belül), a sormagasság a `.css(line:)`-ból jön.
- **Literál szín / árnyék / sarok / betűméret / -súly / átlátszóság az `apps/ios`-ban tilos** (`ParityLintTests`, whitelist: `LiveActivity/LiveMap.swift`, a Mapbox-stílus azonosítói és a térképkép CPU-palettája; a `Sim/` és a `Generated/` kivétel). Új érték a `packages/design-tokens`-be kerül, utána `npm run generate -w @atlagsebesseg/ios`.
- **`npm run parity` a kör-záró ellenőrzés része** (`packages/parity`, Playwright + pixelmatch): 21 állapot × 3 méret (SE 375×667 @2, 17 Pro 402×874 @3, Pro Max 440×956 @3), a web ugyanazzal a biztonsági zónával, rögzített órával és álló lejátszással; a térkép helyett mindkét oldalon a `parityBackdrop` szín (iOS: `-parity YES -parityNow <ms>`, `Sim/Parity.swift`), a rendszer-elemek maszkolva, a szándékos platform-eltérések szelektorral (`mask`). Küszöb: `diff-core.mjs` `THRESHOLDS` (a kép ≤ 4%, a legrosszabb 24 pt-es csempe ≤ 18%, ±2 pt-en belüli illesztéssel; mért érzékenység: 8 pt-es elcsúszástól bukik); önellenőrzés: egy kerek gomb 12 pt-es elcsúsztatásának buknia kell. A csempe-küszöböt csak a `sweep`-szerű méréssel (zaj és érzékenység együtt) szabad állítani. Diff-képek: `docs/parity/diff/`, a kör nem zárható bukó diffel. Kapcsolók: `--device`, `--state`, `--skip-web`, `--skip-ios`, `--skip-build`. A teljes futás ~25 perc: háttérben, PID-re várva (`pgrep -f` a saját figyelőt is megtalálja), a szerkesztés a futás web-fázisában tilos (HMR).
- **Widget-archiválás:** `tsx packages/parity/scripts/live-stress.mjs` (valódi ActivityKit, `-liveStress YES`, a crash-naplók száma); a minták az AppTests-ben is (`LiveStress.samples()`).
- iOS-indítás a kapuhoz: `-simAt N` (a webes `?at=N`), `-parityNoFollow YES`, `-settingsOpen top|zone`.
- A kép-kapu a térképi réteget nem méri: a `Puck`, a „+N perc” címke és a kamera a specekből, a tokenekből és a valódi térképes képekből (`docs/screenshots/*-aos18-*`) ellenőrizendő.

## Szimulátor-szabály (Kristof, AOS18-javítás)
- iOS-ellenőrzés egyszerre csak **EGY** bebootolt szimulátorral: SE → képek + tesztek → leállít → 17 Pro → ugyanez → Pro Max → ugyanez (a `npm run parity` és a `packages/parity/scripts/shots.mjs` így fut).
- Web nav-shots teljes mód csak akkor indul, ha **minden szimulátor le van állítva** (a szkript hibával kilép, ha fut). A kör végén minden szimulátor leállítva. Hosszú futás alatt a gép fedele nyitva maradjon: a `Clamshell Sleep` ellen a `caffeinate` nem véd (`pmset -g log`).

## Jóváhagyott UI (Kristof, 2026-11-03)
- Minden felhasználónak látszó szöveg, ikon-/csempe-/betűméret és elrendezés, amit egy kör záró jelentésében elfogadtak, **befagyasztott**.
  Csak kifejezett utasításra változtatható.
- Ha egy változás miatt egy szöveg mégis pontatlanná válik: a legkisebb szükséges módosítás, és a záró jelentésben külön **„Megváltozott UI”**
  blokk: régi → új, indokkal.
- Paritás-körben az iOS igazodik a webhez, a webhez nem nyúl, csak kifejezett hibánál.
- **Kör közben nem állunk meg kérdezni (Kristof, 2026-11-03):** döntünk, és a záró jelentés „Megváltozott UI” blokkjában utólag tájékoztatunk. Kérdés csak visszafordíthatatlan dolognál (adat törlése, élő tábla átnevezése).

## Szótár és fordítás (AW21, 2026-11-04)
- **Glosszárium és tegezés:** `docs/i18n/glossary.md` (az app tegez: DE „du”, SK/CS/PL „ty”, EN „you”); a lektorálás régi→új táblái: `docs/i18n/review-2026-11-04.md`. Új vagy módosított felirat ehhez igazodik.
- **Hiányzó kulcsnál a webes `t()` magyar szöveget ad** (`DICTIONARIES.hu[key]`), az iOS a nyers kulcsot – ezért a kulcs-teljesség mellett őr védi, hogy egy nem magyar szöveg se legyen azonos a `hu.json`-nal (`i18n.test.ts` `SAME_AS_HU` ↔ `L10nTests.nincsMagyarMasNyelven`; új, szándékosan azonos érték mindkét listába kerül).
- **UI-literál tilos:** weben ESLint (`npm run lint -w @atlagsebesseg/web`, a `npm test` része; `eslint.config.js`: JSX-szöveg és `aria-label` / `title` / `placeholder` / `alt` literál, `toLocale*String('hu…')`) + az `i18n-guard` az `app-logic`-ra is; iOS-en a `LiteralGuardTests.nincsLiteral` több nézet-formára és `title:` / `label:` stb. argumentumra.
- **Minden képernyő × minden nyelv (web):** `npm run i18n:check` 4. blokkja 8 képernyőt nyit 5 nyelven, és bukik, ha a megjelenő szöveg a hu.json értéke vagy ő/ű betűt tartalmaz. iOS-en a lefordított csomagból ugyanez kulcsszinten (a nézetek a `t()`-n át renderelnek, a literál-lint védi a többit).
- ~~**Nyitott (AW21):** manifest, térképfeliratok, widget kijelzőneve~~ – **lezárva az AW22-ben** (lásd ott).

## Három képernyőméret (Kristof, 2026-11-03)
- Minden UI-változást **három képernyőméreten** ellenőrzünk és screenshotolunk, web + iOS: **kicsi** (iPhone SE 3. gen / 375×667, a weben 320 px széles is), **közepes** (iPhone 17 Pro / 390), **nagy** (iPhone 17 Pro Max / 430).
- Mindhárom eszköz telepítve az iOS-szimulátorban; a nav-shots mindhárom szélességen fut (`npm run nav-shots:views -w @atlagsebesseg/web`: 320×667, 375×667, 390×844, 430×932; képek: `npm run view-shots`, 320×568-on is; iOS: UDID-vel, „iPhone SE (3rd generation)”, „iPhone 17 Pro”, „iPhone 17 Pro Max”, iOS 27.0). Ami bármelyiken törik, kilóg vagy elcsúszik, az **hiba**.
- A `view-shots` mér is, és hibakóddal áll le: kezdőképernyő mind a 6 nyelven (egy soros cím, görgetés nélkül kifér), mérőkártya és kompakt ajánlat HU és DE felirattal. A leghosszabb feliratú nyelv (DE) nélkül a szélességi hibák rejtve maradnak.
- `xcodebuild test` frissen létrehozott szimulátoron: előbb `simctl boot` + `simctl bootstatus -b` + kb. 90 s, különben az AppTests el sem indul (a `core-swift` 89 tesztje ettől még lefut, de a teljes eredmény `TEST FAILED`).

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

## nav-shots futtatása (AW20)
- **Közbenső lépésnél csak `npm run nav-shots -w @atlagsebesseg/web -- --check-only`** (háttérben, a végén az „N/M ellenőrzés zöld” sort nézve).
  A **teljes** (képkészítő) mód a kör zárásakor fut, **egyszer** – a mai dátumú képeket felülírja.
- Egy Chrome, egy lap, párhuzamosság 1: a `cdp.mjs` `openPage`-e hibát dob, ha már van nyitott lap; minden lapot `await x.close()`-zal zárj
  (a lap tényleg eltűnik a listából), blokkonként legfeljebb egy van nyitva.
- Térkép a `openPage({ map })`-pal: `blank` (alap: üres helyi stílus, nincs tile / 3D épület / terrain, DPR 1), `real` (valódi stílus 2D-ben,
  DPR 1 – csak a térképet mérő ellenőrzés: címke-elhelyezés, térképstílus), `photo` (éles megjelenés, DPR 3 – a képet adó lapok teljes módban).
  Az app oldalán `window.__mapTest` (`src/map/testMapMode.ts`); éles használatban nincs beállítva. Új ellenőrzésnél: ha a térkép tartalmát
  (nem az app logikáját) méri, `REAL`; különben alapértelmezett.
- A Chrome kapcsolói: `--js-flags=--max-old-space-size=512`, `--disable-gpu-compositing` (`NAV_GPU_COMPOSITING=1` visszakapcsolja), animációk
  `prefers-reduced-motion: reduce`.
- **Gyorsított szimulátor:** a session és az időzítői (újratervezés 5/10/20/30 s, 45 s elfogadás, 2 perces lekérés és dugó-ablak) a minták
  időbélyegéből járó szimulátor-órát olvassák; a `?speed=` csak a lejátszás ütemét adja, a kiírt értékek szimulált másodpercek. Ellenőrző módban
  (`fast(n, szorzó)` a nav-shots.mjs-ben) a képet nem adó, állapot-alapú blokkok 2–8×-szoros szorzóval futnak; a valós `sleep`-et és a valós
  időt mérő ellenőrzést a sebességgel arányosan kell skálázni (pl. `RF_SPEED`, `O_SPEED`, `RPG_SPEED`). Teljes módban a sebességek változatlanok.
- **Teljes (képkészítő) módban** a Chrome GPU-kompozitálással és reduced-motion nélkül fut (DPR 3-nál a kikapcsolt kompozitálás
  lelassítja a renderelést, és az időzítés-érzékeny ellenőrzések buknak). A teljes futás után a felülírt képeket `git checkout -- docs/screenshots`,
  az újonnan keletkezetteket (követetlen `<dátum>-*.png`) törölni kell, ha nem a kör képei.
- Mérés (2026-11-02, AW20): `--check-only` 622 s → 290 s, csúcs RAM (Chrome RSS-összeg) 2961 → 1670 MB, csúcs folyamat 27 → 14; teljes mód 953 s,
  csúcs RAM 1826 MB. Mérés: `ps` mintavétel a Chrome-folyamatokra (összes RSS) a futás alatt.

## Böngésző-tesztelés
- Minden általad megnyitott böngészőtabot zárj be, amikor végeztél.
- Hosszú tesztnél állítsd le a pozíciószimulációt és zárd be a tabot.
- Mapbox tesztnél GPS-frissítés max. 1/mp, animációk és 3D-épületek ki.
- A munka végén ellenőrizd, hogy nem maradt nyitva tab.
- **Headless Chrome-őr (`apps/web/scripts/chrome-guard.mjs`)**: a nav-shots, view-shots, shots, i18n-check és a paritás-harness mind ezen át indít / takarít.
  Indításkor kilövi az előző futásból maradt **árva** Chrome-ot (`user-data-dir=…atlag-(nav|shots|i18n)-…`, szülő: PID 1; élő futás Chrome-ját nem bántja),
  SIGINT / SIGTERM / SIGHUP / kivétel / kilépés esetén szinkron leállítja a Chrome-ot (és a paritás detached vite-ját), és kemény időkorlátot ad:
  alapból 5 perc, view-shots 15 perc (a teljes futás mérve ~7 perc), nav-shots 30 perc, parity 60 perc (`SHOTS_TIMEOUT_MIN` felülírja). A `kill -9` nem kapható el – azt az árva-kilövés fedi a következő indításkor.
- **Megszakított / lelőtt futás után** (TaskStop, időkorlát, `kill -9`) ellenőrizd: `ps aux | grep -E 'user-data-dir=.*atlag-(nav|shots|i18n)-' | grep -v grep`
  (a paritás Playwright-Chrome-ja: `playwright_chromiumdev_profile`). Ha maradt, a következő szkript-indítás kilövi, de a CPU addig is megy – lődd ki kézzel (`kill -9`).
- Szinkron hívásokat (`spawnSync`, `execFileSync`) a watchdog nem tud megszakítani – azoknak saját `timeout` kell (az `ios-shots.mjs`-ben megvan).

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
