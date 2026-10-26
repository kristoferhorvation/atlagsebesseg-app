import type { ExpoConfig } from 'expo/config';

// A Mapbox nyilvános (pk.) tokenje futásidőben, az EXPO_PUBLIC_MAPBOX_TOKEN környezeti változóból jön
// (lásd .env.example). A titkos letöltő tokent (RNMAPBOX_MAPS_DOWNLOAD_TOKEN) – ha egyáltalán kell –
// a natív build olvassa a környezetből; SOHA ne kerüljön ide vagy a repóba.
const config: ExpoConfig = {
  name: 'Átlagsebesség',
  slug: 'atlagsebesseg',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  ios: {
    // TODO: a végleges bundle ID az Apple-fiók létrehozásakor
    bundleIdentifier: 'hu.atlagsebesseg.app',
    supportsTablet: false,
  },
  android: {
    // TODO: a végleges package név a Google Play-fiók létrehozásakor
    package: 'hu.atlagsebesseg.app',
    adaptiveIcon: {
      backgroundColor: '#000000',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    '@rnmapbox/maps',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'A helyzetedből ismeri fel az átlagsebesség-mérő szakaszokat, és ebből számolja az átlagsebességet.',
        // Háttérbeli helymeghatározás a következő körben (Live Activity).
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
      },
    ],
  ],
};

export default config;
