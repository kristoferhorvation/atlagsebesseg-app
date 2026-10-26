import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createMapAdapter, MapProvider } from './src/map';
import { StatusScreen } from './src/screens/StatusScreen';

// Build-időben az .env-ből (EXPO_PUBLIC_MAPBOX_TOKEN) kerül be; a repóban nincs token.
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

export default function App() {
  const adapter = useMemo(() => (MAPBOX_TOKEN ? createMapAdapter(MAPBOX_TOKEN) : null), []);

  if (!adapter) {
    return (
      <View style={styles.missing}>
        <Text style={styles.text}>Hiányzik az EXPO_PUBLIC_MAPBOX_TOKEN.</Text>
        <Text style={styles.text}>Másold az .env.example fájlt .env néven, és add meg a Mapbox pk. tokent.</Text>
      </View>
    );
  }

  return (
    <MapProvider adapter={adapter}>
      <StatusBar style="light" />
      <StatusScreen />
    </MapProvider>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, backgroundColor: '#000', justifyContent: 'center', padding: 24, gap: 12 },
  text: { color: '#fff', fontSize: 16 },
});
