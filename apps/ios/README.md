# Átlagsebesség – natív iOS-app (A9)

SwiftUI, iOS 17+, bundle id `hu.atlagsebesseg.app`. Androidot nem célzunk; új funkció innentől ide
kerül, a web (`apps/web`) hibajavítás szintjén marad.

## Felépítés

| Hely | Mi |
|---|---|
| `project.yml` | XcodeGen-leírás → `Atlagsebesseg.xcodeproj` (generált, nincs a repóban) |
| `Config/App.xcconfig` | közös beállítások; `#include? "../Secrets.xcconfig"` |
| `Secrets.example.xcconfig` | minta a titkokhoz (a valódi `Secrets.xcconfig` gitignore-ban) |
| `Atlagsebesseg/Logic` | az app-logic portja: mérés-munkamenet, kijelző-formázás, beállítások, kamera-láthatóság, csempe-cache, i18n |
| `Atlagsebesseg/Location` | CoreLocation (When In Use + `location` háttér-mód) |
| `Atlagsebesseg/Backend` | Supabase (ugyanazok az RPC-k, mint a weben), beépített adat |
| `Atlagsebesseg/Map` | Mapbox Maps SDK (Standard stílus, szakaszok, kamerák, saját pozíció) |
| `Atlagsebesseg/UI` | mérőkártya, „Lassíts” sáv, kezdőképernyő, beállítások |
| `Atlagsebesseg/Sim` | szimulátor-mód: a webes `/?sim` és `/?navsim` vezetések CoreLocation-mockkal |
| `Atlagsebesseg/Generated` | **generált**: `DesignTokens.swift`, `L10nKey.swift`, `Icons.swift` |
| `Atlagsebesseg/Resources` | **generált**: `Localizable.xcstrings`, `InfoPlist.xcstrings`, `Sim/*.json`; ikon |
| `AtlagsebessegTests` | AppTests (Swift Testing) |
| `scripts/` | generátorok (`npm run generate`), titok-kitöltő (`npm run secrets`) |

A mérőmotor a `packages/core-swift` (`AtlagsebessegCore`) – a TS core 1:1 portja, közös fixtúrákkal.

## Parancsok

```bash
npm run generate -w @atlagsebesseg/ios   # tokenek, String Catalog, ikonok, szimulátor-fixtúrák
npm run secrets  -w @atlagsebesseg/ios   # Secrets.xcconfig az apps/web/.env nyilvános kulcsaiból
cd apps/ios && xcodegen generate         # Atlagsebesseg.xcodeproj

# tesztek (AppTests + core-swift a sémában)
xcodebuild test -project Atlagsebesseg.xcodeproj -scheme Atlagsebesseg \
  -destination 'platform=iOS Simulator,name=iPhone Duo'

# eszközre, aláírás nélkül (fordítás-ellenőrzés)
xcodebuild build -project Atlagsebesseg.xcodeproj -scheme Atlagsebesseg \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
```

A `npm test` a gyökérből a generált fájlok frissességét is ellenőrzi (`apps/ios/test/generated.test.ts`).

## Szimulátor-mód

A beállításokban (Fejlesztés → Szimulátor), vagy indítási argumentummal:

```bash
xcrun simctl launch booted hu.atlagsebesseg.app -sim lassit -simSeek 0.5 -simSpeed 4 -simPanel NO
```

Forgatókönyvek: `jo`, `tul`, `lassit`, `alagut` (a webes tesztpálya) és `navsim` (Budapest → Győr, M1).
A minták `CLLocation`-ként jönnek, így a mérés ugyanazon az úton fut, mint valódi GPS-sel.

## Telepítés a saját iPhone-ra (Kristof)

1. Terminálban: `cd ~/Desktop/atlagsebesseg-app/apps/ios && npm run secrets && xcodegen generate`,
   majd `open Atlagsebesseg.xcodeproj`.
2. Xcode → Settings… → **Accounts** → `+` → Apple ID → bejelentkezés (ingyenes fiók is jó).
3. A bal oldali listában a kék **Atlagsebesseg** projekt → **TARGETS: Atlagsebesseg** →
   **Signing & Capabilities** fül:
   - **Automatically manage signing**: bekapcsolva,
   - **Team**: a saját neved (Personal Team),
   - ha a bundle id foglalt („Failed to register bundle identifier”), írd át egyedire,
     pl. `hu.atlagsebesseg.app.kristof` – a `project.yml`-ben is, különben a következő
     `xcodegen generate` visszaírja.
   - A **Background Modes → Location updates** már be van állítva (Info.plist).
4. iPhone USB-n a Machez → a telefonon „Megbízol ebben a számítógépben?” → **Megbízom**.
   iOS 16+: Beállítások → Adatvédelem és biztonság → **Fejlesztői mód** → be, újraindítás.
5. Xcode felső sávjában a futtatási cél: a **saját iPhone-od** (nem szimulátor) → **▶ (Cmd+R)**.
6. Első indításkor, ha „Untrusted Developer”: a telefonon Beállítások → Általános →
   **VPN és eszközkezelés** → a fejlesztői tanúsítványod → **Megbízom**, majd újra ▶.
7. Az appban **Indulás** → helyhozzáférés: **Az app használata közben**.

Ingyenes fiókkal a telepítés 7 napig érvényes; utána újra ▶ az Xcode-ból.
