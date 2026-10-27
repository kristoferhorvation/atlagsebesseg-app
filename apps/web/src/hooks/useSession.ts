import { useEffect, useMemo, useRef, useState } from 'react';
import { TrackingSession, type SessionView } from '@atlagsebesseg/app-logic';
import type { GpsFix, Section } from '@atlagsebesseg/core';

/** A mérés-munkamenet React-kötése; az óra cserélhető (a szimulátor a lejátszás idejét adja). */
export function useSession(sections: readonly Section[], now: () => number) {
  const ref = useRef<TrackingSession | null>(null);
  ref.current ??= new TrackingSession(sections, { now });
  const session = ref.current;
  const [view, setView] = useState<SessionView>(() => session.view());

  useEffect(() => {
    session.setSections(sections);
  }, [session, sections]);

  const actions = useMemo(
    () => ({
      onFix: (fix: GpsFix) => setView(session.onFix(fix)),
      tick: () => setView(session.tick()),
      interrupt: () => setView(session.interrupt('hatter')),
      startManual: () => setView(session.startManual()),
      stopManual: () => setView(session.stopManual()),
      dismiss: () => setView(session.dismiss()),
    }),
    [session],
  );
  return { view, ...actions };
}
