import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RequiredSpeed, TrackerState } from '@atlagsebesseg/core';
import { BUNDLED_SECTIONS } from '../data/sections';
import { useMap } from '../map';
import { useLocationFixes } from '../tracking/useLocationFixes';
import { useTracking } from '../tracking/useTracking';

const STATE_LABEL: Record<TrackerState, string> = {
  nincs_szakasz: 'Nincs szakasz',
  kozeledik: 'Szakasz közeledik',
  szakaszon: 'Szakaszon',
  kesz: 'Szakasz vége',
  megszakadt: 'Mérés megszakadt',
};

const kmh = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v)} km/h`);

function requiredText(r: RequiredSpeed): string {
  if (r.kind === 'nincs_korlat') return 'bármekkora (a határ alatt maradsz)';
  if (r.kind === 'nem_lehetseges') return `már nem lehetséges (${kmh(r.maxKmh)} kellene)`;
  return `legfeljebb ${kmh(r.maxKmh)}`;
}

/** Ideiglenes, dizájn nélküli képernyő: térkép + a core állapota és az átlag. */
export function StatusScreen() {
  const map = useMap();
  const { snapshot, onFix, manualSnap, manualResult, toggleManual } = useTracking(BUNDLED_SECTIONS);
  const locationStatus = useLocationFixes(onFix);

  useEffect(() => {
    map.setLightPreset('night');
    map.followUser(true);
  }, [map]);

  const activeId = snapshot?.state === 'szakaszon' ? snapshot.section?.id ?? null : null;
  useEffect(() => {
    map.showSections(BUNDLED_SECTIONS, activeId);
  }, [map, activeId]);

  const live = snapshot?.live;
  return (
    <View style={styles.root}>
      <map.MapView style={styles.map} />
      <View style={styles.panel}>
        <Text style={styles.small}>
          GPS: {locationStatus} · betöltött szakaszok: {BUNDLED_SECTIONS.length}
        </Text>
        <Text style={styles.state}>{snapshot ? STATE_LABEL[snapshot.state] : '…'}</Text>
        {snapshot?.section && (
          <Text style={styles.small}>
            {snapshot.section.road} {snapshot.section.direction} · {(snapshot.section.lengthM / 1000).toFixed(1)} km ·
            határ {snapshot.section.speedLimitKmh} km/h
          </Text>
        )}
        {live && (
          <>
            <Text style={styles.big}>{kmh(live.averageKmh)}</Text>
            <Text style={styles.text}>átlag{live.estimated ? ' (becsült – nincs GPS)' : ''}</Text>
            <Text style={styles.text}>hátralévő út: {(live.remainingM / 1000).toFixed(2)} km</Text>
            <Text style={styles.text}>megengedett sebesség: {requiredText(live.required)}</Text>
            <Text style={styles.text}>lassíts: {kmh(live.slowDownKmh)}</Text>
          </>
        )}
        {snapshot?.state === 'megszakadt' && <Text style={styles.text}>ok: {snapshot.abortReason}</Text>}
        {snapshot?.lastResult && !live && (
          <Text style={styles.text}>
            utolsó szakasz átlaga: {kmh(snapshot.lastResult.averageKmh)}
            {snapshot.lastResult.overLimit ? ' – HATÁR FELETT' : ''}
          </Text>
        )}

        <Pressable style={styles.button} onPress={toggleManual} accessibilityRole="button">
          <Text style={styles.buttonText}>{manualSnap ? 'Kézi mérés leállítása' : 'Kézi mérés indítása'}</Text>
        </Pressable>
        {manualSnap && (
          <Text style={styles.text}>
            kézi: {(manualSnap.distanceM / 1000).toFixed(2)} km · átlag {kmh(manualSnap.averageKmh)}
          </Text>
        )}
        {manualResult && (
          <Text style={styles.text}>
            kézi eredmény: {(manualResult.distanceM / 1000).toFixed(2)} km, {Math.round(manualResult.elapsedMs / 1000)} s,
            átlag {kmh(manualResult.averageKmh)}
          </Text>
        )}
        <Text style={styles.attribution}>Szakaszadatok: © OpenStreetMap contributors (ODbL)</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },
  panel: { padding: 16, paddingBottom: 32, backgroundColor: '#111', gap: 4 },
  state: { color: '#fff', fontSize: 22, fontWeight: '600' },
  big: { color: '#fff', fontSize: 56, fontWeight: '700' },
  text: { color: '#ddd', fontSize: 16 },
  small: { color: '#999', fontSize: 13 },
  button: { marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: '#333', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16 },
  attribution: { color: '#666', fontSize: 11, marginTop: 8 },
});
