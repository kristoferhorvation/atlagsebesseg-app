import { useEffect, useState } from 'react';
import { lightPresetAt, type LightPreset } from '@atlagsebesseg/app-logic';
import type { LatLon } from '@atlagsebesseg/core';

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** Térkép-előbeállítás a rendszer világos/sötét módjából és a helyi napállásból (percenként). */
export function useLightPreset(pos: LatLon | null, now: () => number): LightPreset {
  const [dark, setDark] = useState(() => darkQuery()?.matches ?? true);
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const q = darkQuery();
    const onChange = () => setDark(q?.matches ?? true);
    q?.addEventListener('change', onChange);
    const id = setInterval(() => setMinute((m) => m + 1), 60_000);
    return () => {
      q?.removeEventListener('change', onChange);
      clearInterval(id);
    };
  }, []);
  // a pozíciót fokban kerekítjük, hogy ne számoljunk minden fixnél
  const lat = pos ? Math.round(pos.lat * 10) / 10 : null;
  const lon = pos ? Math.round(pos.lon * 10) / 10 : null;
  void minute;
  return lightPresetAt(now(), lat === null || lon === null ? null : { lat, lon }, dark ? 'dark' : 'light');
}
