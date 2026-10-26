import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import type { GpsFix } from '@atlagsebesseg/core';

export type LocationStatus = 'kerdes' | 'engedelyezve' | 'elutasitva' | 'hiba';

/** Előtérbeli GPS-figyelés, másodpercenként; minden fixet `GpsFix`-ként ad tovább. */
export function useLocationFixes(onFix: (fix: GpsFix) => void): LocationStatus {
  const [status, setStatus] = useState<LocationStatus>('kerdes');
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          setStatus('elutasitva');
          return;
        }
        setStatus('engedelyezve');
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (loc) => onFixRef.current(toGpsFix(loc)),
        );
        if (cancelled) sub.remove();
      } catch {
        if (!cancelled) setStatus('hiba');
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return status;
}

export function toGpsFix(loc: Location.LocationObject): GpsFix {
  const { latitude, longitude, speed, heading, accuracy } = loc.coords;
  return {
    lat: latitude,
    lon: longitude,
    timestamp: loc.timestamp,
    speed: speed !== null && speed >= 0 ? speed : null,
    accuracy: accuracy ?? null,
    heading: heading !== null && heading >= 0 ? heading : null,
  };
}
