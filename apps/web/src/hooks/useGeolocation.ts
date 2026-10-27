import { useEffect, useRef, useState } from 'react';
import type { GpsFix } from '@atlagsebesseg/core';
import { toGpsFix } from '../gps/toGpsFix';

export type GeoStatus = 'ki' | 'kereses' | 'aktiv' | 'elutasitva' | 'nem_elerheto' | 'hiba';

/** `navigator.geolocation.watchPosition` nagy pontossággal; minden fixet `GpsFix`-ként ad tovább. */
export function useGeolocation(enabled: boolean, onFix: (fix: GpsFix) => void): GeoStatus {
  const [status, setStatus] = useState<GeoStatus>('ki');
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;

  useEffect(() => {
    if (!enabled) {
      setStatus('ki');
      return;
    }
    if (!('geolocation' in navigator)) {
      setStatus('nem_elerheto');
      return;
    }
    if (!window.isSecureContext) {
      // a geolocation csak HTTPS-en (vagy localhoston) működik
      setStatus('nem_elerheto');
      return;
    }
    setStatus('kereses');
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setStatus('aktiv');
        onFixRef.current(toGpsFix(p));
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'elutasitva' : err.code === err.TIMEOUT ? 'kereses' : 'hiba'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return status;
}
