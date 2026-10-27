import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { chooseLightPreset, type LightPreset } from '@atlagsebesseg/app-logic';
import { sunPhase, type GpsFix } from '@atlagsebesseg/core';

/** Térkép-előbeállítás a rendszer világos/sötét módjából és a helyi napállásból (percenként frissül). */
export function useAutoLightPreset(lastFix: GpsFix | null): LightPreset {
  const scheme = useColorScheme();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const phase = lastFix ? sunPhase(now, lastFix.lat, lastFix.lon) : null;
  return chooseLightPreset(phase, scheme);
}
