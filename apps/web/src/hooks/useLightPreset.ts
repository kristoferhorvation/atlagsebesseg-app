import { useEffect, useState } from 'react';
import { lightPresetAt, type LightPreset } from '@atlagsebesseg/app-logic';
import type { LatLon } from '@atlagsebesseg/core';

/** Napszak szerinti térkép-előbeállítás a helyi napállásból (percenként; a sötét mód nem számít). */
export function useLightPreset(pos: LatLon | null, now: () => number): LightPreset {
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinute((m) => m + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // a pozíciót fokban kerekítjük, hogy ne számoljunk minden fixnél
  const lat = pos ? Math.round(pos.lat * 10) / 10 : null;
  const lon = pos ? Math.round(pos.lon * 10) / 10 : null;
  void minute;
  return lightPresetAt(now(), lat === null || lon === null ? null : { lat, lon });
}
