# apps/mobile – Expo váz

Expo SDK 58, React Native 0.88, TypeScript, `@rnmapbox/maps` 10.3, `@supabase/supabase-js`.
Egyelőre egyetlen, dizájn nélküli képernyő: térkép (Mapbox Standard) + a `core` állapota, az
átlag, a megengedett sebesség, kézi mérés gomb, kapu-bejelentés és a tűrés-kapcsoló.

## Beállítás

```bash
cp .env.example .env      # EXPO_PUBLIC_MAPBOX_TOKEN=pk...., SUPABASE_URL, SUPABASE_ANON_KEY
```

Mapbox-token nélkül az app egy figyelmeztető képernyőt mutat; Supabase nélkül offline módban
fut (csak az appba csomagolt szakaszokkal). A Supabase URL és az anon kulcs az `app.config.ts`
`extra` mezőjén át jut az appba; a service role kulcs soha. A `.env` gitignore-ban van, valódi token
soha nem kerül a repóba. A Mapbox SDK letöltéséhez titkos token már nem kell.

## Futtatás

A `@rnmapbox/maps` natív modul, ezért **Expo Go nem elég**, development build kell:

```bash
npm run ios        # expo run:ios     (Xcode, helyi gépen)
npm run android    # expo run:android (Android Studio / SDK)
# vagy felhőben: npx eas-cli@latest build --profile development
```

Az `ios/` és `android/` mappák generáltak (Continuous Native Generation, gitignore-ban);
a natív beállítás az `app.config.ts`-ben és a config pluginokban van.

## Adat és szerver

- **Bejelentkezés:** induláskor anonim (`signInAnonymously`), a munkamenet AsyncStorage-ben marad.
  A Supabase-projektben az anonim bejelentkezést be kell kapcsolni.
- **Szakaszok:** `sections_in_bbox` csempénként (0,5° × 0,5°, a környező 3 × 3 csempe),
  AsyncStorage-cache 24 órás frissességgel. Hálózat nélkül a lejárt cache, végül az appba
  csomagolt `packages/data/output/*.json` a tartalék. Csempeváltáskor újratölt; a futó mérést a
  frissítés nem szakítja meg (`SectionTracker.setSections`).
- **Bejelentések:** a környék aktív bejelentései (`active_reports`), írás és szavazás bejelentkezve.
- **Ideiglenes kapuk:** kézi mérés befejezése után egy gomb bejelenti a kezdő- és a zárókaput
  (hely + irány); a szerver 3 független megerősítés után szakaszt készít belőlük.
- **Beállítás:** `hatosagi_tures_megjelenitese` (alapból ki) – ha be, a kijelző a határ + tűrést
  is mutatja (5% vagy 5 km/h, a nagyobb); a megengedett sebesség mindig a szigorú határhoz számol.
- **Térkép világítása:** a rendszer világos/sötét módja és a helyi napállás alapján percenként
  (`src/logic/lightPreset.ts`): világos módban nappal `day`, hajnalban `dawn`, alkonyatkor `dusk`,
  éjjel `night`; sötét módban nappal `dusk`, egyébként `night`.

## Térkép-adapter

`src/map/MapAdapter.ts` – az interfész (`showSections`, `followUser`, `setLightPreset`, `MapView`).
`src/map/MapboxAdapter.tsx` – az egyetlen Mapbox-függő fájl. Az app többi része a `useMap()`
hookon át csak az interfészt látja; MapLibre-re váltáskor a `createMapAdapter` (`src/map/index.ts`)
adjon vissza másik implementációt.

## Ellenőrzés

```bash
npm test                             # a React Native-mentes logika (src/logic) vitesttel
npm run typecheck
npx expo export --platform android   # JS-bundle fordítása natív build nélkül
```
