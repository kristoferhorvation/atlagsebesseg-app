import { useCallback, useEffect, useRef, useState } from 'react';
import type { GpsFix } from '@atlagsebesseg/core';
import { retryOnGesture, type GeoPermission, type GeoStatus } from '@atlagsebesseg/app-logic';
import { toGpsFix } from '../gps/toGpsFix';

export type { GeoStatus } from '@atlagsebesseg/app-logic';

export interface Geolocation {
  status: GeoStatus;
  /** A Permissions API `geolocation` állapota; `unknown`, ha a böngésző nem adja meg. */
  permission: GeoPermission;
  /** Új kérés (felhasználói gesztusból hívva: a Mac Safari csak így kérdez). */
  request: () => void;
}

/**
 * `navigator.geolocation.watchPosition` nagy pontossággal; minden fixet `GpsFix`-ként ad tovább. Indításkor magától
 * kér (AW13): ha ez nem jut el a pozícióig és az engedély nincs eldöntve, az első érintés / kattintás bárhol újra kér;
 * az engedély változására (pl. a beállításokban visszakapcsolva) is újraindul.
 */
export function useGeolocation(enabled: boolean, onFix: (fix: GpsFix) => void): Geolocation {
  const [status, setStatus] = useState<GeoStatus>('ki');
  const [permission, setPermission] = useState<GeoPermission>('unknown');
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;
  const watchRef = useRef<number | null>(null);
  const state = useRef({ status, permission });
  state.current = { status, permission };

  // szinkron indítás: gesztusból hívva a kérés a gesztushoz tartozik; az új figyelés előbb indul, mint a régi leáll,
  // hogy egy függő engedélykérés ne szakadjon meg
  const start = useCallback(() => {
    if (!('geolocation' in navigator) || !window.isSecureContext) return;
    const prev = watchRef.current;
    setStatus((s) => (s === 'aktiv' ? s : 'kereses'));
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setStatus('aktiv');
        onFixRef.current(toGpsFix(p));
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'elutasitva' : err.code === err.TIMEOUT ? 'kereses' : 'hiba'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    if (prev !== null) navigator.geolocation.clearWatch(prev);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('ki');
      return;
    }
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      // a geolocation csak HTTPS-en (vagy localhoston) működik
      setStatus('nem_elerheto');
      return;
    }
    start();
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    };
  }, [enabled, start]);

  // Permissions API: az aktuális engedély, és a változására újrakérés (a tiltás feloldása után)
  useEffect(() => {
    if (!enabled || !navigator.permissions?.query) return;
    let ps: PermissionStatus | null = null;
    let alive = true;
    const onChange = () => {
      if (!ps) return;
      setPermission(ps.state);
      if (ps.state !== 'denied' && state.current.status !== 'aktiv') start();
    };
    navigator.permissions.query({ name: 'geolocation' }).then(
      (s) => {
        if (!alive) return;
        ps = s;
        setPermission(s.state);
        s.addEventListener('change', onChange);
      },
      () => undefined,
    );
    return () => {
      alive = false;
      ps?.removeEventListener('change', onChange);
    };
  }, [enabled, start]);

  // az első érintés / kattintás bárhol: újrakérés, ha az automatikus kérés nem jutott el a pozícióig
  useEffect(() => {
    if (!enabled) return;
    const onGesture = () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      if (retryOnGesture(state.current.permission, state.current.status)) start();
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    return () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    };
  }, [enabled, start]);

  return { status, permission, request: start };
}
