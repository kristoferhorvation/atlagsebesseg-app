import { useCallback, useEffect, useRef, useState } from 'react';

export type WakeStatus = 'nem_tamogatott' | 'aktiv' | 'inaktiv';

/**
 * Screen Wake Lock: a kijelző ne aludjon el. A rendszer háttérbe kerüléskor elengedi, ezért
 * előtérbe érve újrakérjük; ha ez gesztus nélkül nem sikerül, a `request` koppintásra újrapróbál.
 */
export function useWakeLock(enabled: boolean): { status: WakeStatus; request: () => void } {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [status, setStatus] = useState<WakeStatus>(supported ? 'inaktiv' : 'nem_tamogatott');
  const sentinel = useRef<WakeLockSentinel | null>(null);

  const request = useCallback(() => {
    if (!supported || document.visibilityState !== 'visible') return;
    if (sentinel.current && !sentinel.current.released) return;
    navigator.wakeLock
      .request('screen')
      .then((s) => {
        sentinel.current = s;
        setStatus('aktiv');
        s.addEventListener('release', () => setStatus('inaktiv'));
      })
      .catch(() => setStatus('inaktiv'));
  }, [supported]);

  useEffect(() => {
    if (!enabled || !supported) return;
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel.current?.release().catch(() => undefined);
      sentinel.current = null;
    };
  }, [enabled, supported, request]);

  return { status, request };
}
