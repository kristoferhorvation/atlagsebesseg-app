import { useEffect, useState } from 'react';
import { chooseLightPreset, type LightPreset } from '@atlagsebesseg/app-logic';
import { sunPhase, type GpsFix } from '@atlagsebesseg/core';

/** Térkép-előbeállítás a helyi napállásból (percenként frissül; AW16: a sötét mód nem számít). */
export function useAutoLightPreset(lastFix: GpsFix | null): LightPreset {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const phase = lastFix ? sunPhase(now, lastFix.lat, lastFix.lon) : null;
  return chooseLightPreset(phase);
}
