# AtlagsebessegCore (Swift)

A `packages/core` (TypeScript) 1:1 Swift-portja (A9): szakasz-geometria (`Route`), pozíció-vetítés,
fix-szűrés, automatikus szakasz-felismerés és mérés (`SectionTracker`), kézi mérés és ideiglenes kapuk
(`ManualTracker`, `ManualGate`), átlag / szükséges sebesség / várható végső átlag, mérőkártya-állapot
(`meterState`, `meterBar`: jó / lassíts / túl gyors), tűrés, „nem lehetséges” küszöb, napállás.
Függőségmentes, mint a TS core.

## Paritási szabály

- Core-változás **mindkét nyelvben** egyszerre, ugyanazzal a viselkedéssel.
- A tesztek bemenete közös: `packages/core/fixtures` (JSON). A fixtúrákat a
  `packages/core/test/helpers/fixtureSpecs.ts` írja le, kiírás: `npm run fixtures -w @atlagsebesseg/core`.
  A TS `fixtures.test.ts` bukik, ha a lemezen lévő fixtúra nem friss.
- Minden TS-teszt (`it`) egy Swift `@Test` ugyanazzal a névvel és ellenőrzésekkel; az `it.each` paraméterezett teszt.

## Névmegfeleltetés

| TS | Swift |
|---|---|
| `'nincs_szakasz'`, `'tul_gyors'`, `'km_szelveny'` | `.nincsSzakasz`, `.tulGyors`, `.kmSzelveny` (a nyers érték a TS-szöveg) |
| `RequiredSpeed` `{ kind, maxKmh }` | `enum RequiredSpeed` (`.kind` a TS-szöveget adja) |
| `DEFAULT_TRACKER_OPTIONS`, `DEFAULT_FIX_FILTER`, `DEFAULT_TOLERANCE` | `TrackerOptions.default`, `FixFilterOptions.default`, `ToleranceRule.default` |
| `null` | `nil` |
| objektum-azonosság (`===`) a `setSections`-ben | érték-egyenlőség (`Section: Hashable`) |
| `new Route(…)` dob < 2 pontnál | `try Route(…)`; a trackerben az ilyen szakasz kimarad |

## Futtatás

```bash
cd packages/core-swift && swift test          # macOS
# vagy az iOS-app sémájában: xcodebuild test … (apps/ios)
```
