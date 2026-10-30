import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { tileBBox, tileKey } from '@atlagsebesseg/app-logic';
import { limitWithToleranceKmh, type GpsFix, type RequiredSpeed, type TrackerState } from '@atlagsebesseg/core';
import { listActiveReports } from '../backend/reportsRepo';
import { ensureSignedIn, supabase } from '../backend/supabase';
import { useMap } from '../map';
import { useAutoLightPreset } from '../map/useAutoLightPreset';
import { useSettings } from '../settings/useSettings';
import { useLocationFixes } from '../tracking/useLocationFixes';
import { useSections } from '../tracking/useSections';
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
  const [lastFix, setLastFix] = useState<GpsFix | null>(null);
  const { sections, status: sectionsStatus } = useSections(lastFix);
  const { snapshot, onFix, manualSnap, manualResult, toggleManual } = useTracking(sections);
  const handleFix = useCallback(
    (fix: GpsFix) => {
      onFix(fix);
      setLastFix(fix);
    },
    [onFix],
  );
  const locationStatus = useLocationFixes(handleFix);
  const lightPreset = useAutoLightPreset(lastFix);
  const { settings, update: updateSettings } = useSettings();
  const [authStatus, setAuthStatus] = useState<'nincs_beallitva' | 'bejelentkezes' | 'anon' | 'hiba'>(
    supabase ? 'bejelentkezes' : 'nincs_beallitva',
  );
  const [reportCount, setReportCount] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase) return;
    ensureSignedIn()
      .then(() => setAuthStatus('anon'))
      .catch(() => setAuthStatus('hiba'));
  }, []);

  // aktív bejelentések a környéken (csempeváltáskor)
  const tile = lastFix ? tileKey(lastFix.lat, lastFix.lon) : null;
  useEffect(() => {
    if (!supabase || !tile) return;
    listActiveReports(tileBBox(tile))
      .then((r) => setReportCount(r.length))
      .catch(() => setReportCount(null));
  }, [tile]);

  useEffect(() => {
    map.followUser(true);
  }, [map]);

  useEffect(() => {
    map.setLightPreset(lightPreset);
  }, [map, lightPreset]);

  const activeId = snapshot?.state === 'szakaszon' ? snapshot.section?.id ?? null : null;
  useEffect(() => {
    map.showSections(sections, activeId);
  }, [map, sections, activeId]);

  const live = snapshot?.live;
  return (
    <View style={styles.root}>
      <map.MapView style={styles.map} />
      <View style={styles.panel}>
        <Text style={styles.small}>
          GPS: {locationStatus} · szakaszok: {sections.length} ({sectionsStatus}) · szerver: {authStatus}
          {reportCount !== null ? ` · bejelentések a környéken: ${reportCount}` : ''} · térkép: {lightPreset}
        </Text>
        <Text style={styles.state}>{snapshot ? STATE_LABEL[snapshot.state] : '…'}</Text>
        {snapshot?.section && (
          <Text style={styles.small}>
            {snapshot.section.road} {snapshot.section.direction} · {(snapshot.section.lengthM / 1000).toFixed(1)} km ·
            határ {snapshot.section.speedLimitKmh} km/h
          </Text>
        )}
        {snapshot?.section && settings.hatosagi_tures_megjelenitese && (
          <Text style={styles.small}>
            határ + tűrés: {kmh(limitWithToleranceKmh(snapshot.section.speedLimitKmh))} (a számítás a szigorú határhoz)
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
        <View style={styles.row}>
          <Text style={styles.text}>Hatósági tűrés megjelenítése</Text>
          <Switch
            value={settings.hatosagi_tures_megjelenitese}
            onValueChange={(v) => updateSettings({ hatosagi_tures_megjelenitese: v })}
          />
        </View>
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
});
