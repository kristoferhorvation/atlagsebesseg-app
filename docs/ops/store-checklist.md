# App Store – kiadás előtti lista (AW25-től vezetve, AW25b-ben frissítve: 2026-11-06)

## Claude Code megcsinálta

| Dátum | Kör | Mi | Hol |
|---|---|---|---|
| 2026-11-06 | AW25 | Napi kvóta telepítésenként (adatbázis-trigger), 90 napos megőrzés, 30 napos fiók-visszaállítás | `supabase/migrations/20261106000000_store_vedelem.sql` |
| 2026-11-06 | AW25 | Jogi szövegek 4 × 6 nyelven, ügyvédi lista, App Privacy címke-útmutató | `docs/legal/`, `docs/ops/app-privacy-labels.md` |
| 2026-11-06 | AW25b | Közösségi „Rendőrség” / „Traffipax” a kamera-szabállyal (CH rejtve, FR zóna, DE pont + figyelmeztetés), web + iOS (INV-26) | `packages/app-logic/src/cameras.ts`, `docs/legal/terms.*.md` 4. pont |
| 2026-11-06 | AW25b | Mentett helyek, legutóbbi célok, út-napló: koordináta-kulcs, Mapbox-azonosító / -név nélkül (INV-27) | `docs/ops/mapbox-tarolt-adat.md` |
| 2026-11-06 | AW25b | A szimulátor hőtérkép-útjai OSM-ből (OSRM), a Mapbox Directions-geometria helyett | `apps/web/scripts/record-heat-seed.mts` |
| 2026-11-06 | AW25b | iOS `PrivacyInfo.xcprivacy` (app + widget), a címke-útmutatóval egyezően | `apps/ios/Atlagsebesseg/Resources/`, `apps/ios/AtlagsebessegWidget/` |
| 2026-11-06 | AW25b | Helyhasználati indoklás 6 nyelven, háttér-GPS (`NSLocationAlwaysAndWhenInUseUsageDescription`) | szótár `ios.locationUsage`, `ios.locationAlwaysUsage` |
| 2026-11-06 | AW25b | iOS Beállítások › Adatvédelem › „Tájékoztató” (webes paritás) | `UI/SettingsSheet.swift` |
| 2026-11-06 | AW25b | iOS captcha-kód előkészítve, KIKAPCSOLVA | `Logic/Captcha.swift` |
| 2026-11-06 | AW25b | Release-ben a szimulátor nem küld a szerverre, a Beállítások szimulátor-sora rejtett (a GPS-sorra 5 koppintás nyitja – az App Review tesztútmutatójához); weben az éles buildben nem küld | `App/AppModel+Reports.swift`, `apps/web/src/App.tsx` |
| 2026-11-06 | AW25b | App Store Connect: kategória Navigation / Travel, kor-besorolás (minden „nincs”), ár ingyenes, elérhetőség EU 27 + UK + CH + RS (30 ország, új országba nem automatikus), support és privacy URL, 6 nyelvű verzió-lokalizáció (szöveg nélkül), review-jegyzet, IDFA: nem | `apps/ios/scripts/asc.mjs meta`, `docs/store/review-notes.en.txt` |
| 2026-11-06 | AW25b | Szöveges adatlap 6 nyelven – CSAK fájlban, jóváhagyásra | `docs/store/listing.md`, ellenőrzés: `node docs/store/listing-check.mjs` |

## Kristof lépései

| Lépés | Mi kell | Leírás | Becsült idő |
|---|---|---|---|
| Adatlap jóváhagyása | a szövegek átnézése / javítása | `docs/store/listing.md`; utána egy Claude Code-kör feltölti | 20 perc |
| DNS + Resend-kulcs | `app.tempomate.app` CNAME a Vercelre, Resend-domain rekordjai, `.env.resend` | `docs/ops/dns-tempomate.md`; utána **[C]** `setup-resend` + `RESEND_API_KEY` a Supabase-titkokba, a régi cím 301-e | 45 perc + DNS-terjedés |
| Apple Sign-in kulcs + Services ID | Apple Developer › Keys (Sign in with Apple), Services ID a webhez, a Supabase Auth › Apple mezői | `docs/ops/dns-tempomate.md` (Auth-URL-ek), Supabase: Authentication › Providers › Apple | 30 perc |
| Google OAuth | Google Cloud OAuth-kliens (iOS + web), a Supabase Auth › Google mezői | Supabase: Authentication › Providers › Google | 30 perc |
| Turnstile | Cloudflare Turnstile site key + secret; a secret a Supabase Auth › Bot and Abuse Protection-be | utána **[C]** captcha be: `packages/app-logic/src/captcha.ts`, `apps/ios/Atlagsebesseg/Logic/Captcha.swift` (+ iOS token-adó); **sorrend:** előbb a kliensek, csak utána a Supabase-kapcsoló | 20 perc |
| Mapbox-token korlát | a nyilvános `pk.` token URL-korlátja (web: a két domain) és a fiók költségkorlátja | Mapbox › Account › Tokens; `docs/ops/mapbox-tarolt-adat.md` | 15 perc |
| App Privacy címke | ASC › App Privacy kitöltése | `docs/ops/app-privacy-labels.md` (a Mapbox SDK sora is) | 30 perc |
| Review-kapcsolattartó | ASC › App Review Information: név, telefon, e-mail (a jegyzet már fent van; módosításhoz ez kötelező) | ASC › az 1.0 verzió | 5 perc |
| Kor-besorolás ellenőrzése | az API-val beállított válaszok átnézése (bejelentés = rögzített típus, nem szabad szöveg → „User-Generated Content: nem”) | ASC › App Information › Age Rating | 5 perc |
| Ügyvédi átnézés | 14 pont, köztük a közösségi bejelentések (6.) | `docs/legal/ugyvedi-atnezes.md` | ügyvédtől függ |
| Adatkezelő adatai | cím (és cégadatok) a `docs/legal/*` placeholderek helyére, majd `npm run legal -w @atlagsebesseg/web` | `docs/legal/` | 15 perc |
| Landing-oldalak | tempomate.app /privacy, /terms, /support, /imprint a `docs/legal/*.md`-ből (a support és a privacy URL már az ASC-ben van) | `docs/marketing/lovable-prompt.md` | 1 óra |
| Régi felhős utak célja | engedély egy egyszeri adat-módosításra (`cloud_trips` régi Mapbox-nevei) | `docs/ops/mapbox-tarolt-adat.md` › Nyitott | 5 perc döntés |
| Directions-fixtúra | döntés a teljes Mapbox Directions-fixtúra cseréjéről (navigációs tesztek) | `docs/ops/mapbox-tarolt-adat.md` › Nyitott | 5 perc döntés |
| Beadás | „Add for Review” – csak a fentiek után | ASC | 10 perc |

## Kiadás előtt lezárandó (CLAUDE.md › TestFlight)
- [x] Release-ben a Beállítások szimulátor-sora rejtett (5 koppintás a GPS-sorra), a szimulátor nem küld az éles Supabase-re (AW25b).
- [x] Map Matching-eredmény tárolása: kivezetve (AW25).
- [ ] **[C]** Captcha bekapcsolása a Turnstile-kulcs után (lásd fent).
- [ ] **[C]** Valódi levél-próba nem csapattag címre (a Resend-kulcs után).
