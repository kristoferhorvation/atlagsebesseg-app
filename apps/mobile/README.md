# apps/mobile – Expo váz

Expo SDK 58, React Native 0.88, TypeScript, `@rnmapbox/maps` 10.3. Egyelőre egyetlen,
dizájn nélküli képernyő: térkép (Mapbox Standard, `lightPreset: night`) + a `core` állapota,
az átlag, a megengedett sebesség és egy kézi mérés gomb.

## Beállítás

```bash
cp .env.example .env      # és add meg: EXPO_PUBLIC_MAPBOX_TOKEN=pk....
```

Token nélkül az app egy figyelmeztető képernyőt mutat. A `.env` gitignore-ban van, valódi token
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

## Térkép-adapter

`src/map/MapAdapter.ts` – az interfész (`showSections`, `followUser`, `setLightPreset`, `MapView`).
`src/map/MapboxAdapter.tsx` – az egyetlen Mapbox-függő fájl. Az app többi része a `useMap()`
hookon át csak az interfészt látja; MapLibre-re váltáskor a `createMapAdapter` (`src/map/index.ts`)
adjon vissza másik implementációt.

## Ellenőrzés

```bash
npm run typecheck
npx expo export --platform android   # JS-bundle fordítása natív build nélkül
```
