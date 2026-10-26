import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ManualTracker,
  SectionTracker,
  type GpsFix,
  type ManualResult,
  type ManualSnapshot,
  type Section,
  type TrackerSnapshot,
} from '@atlagsebesseg/core';

/** A core bekötése: automatikus szakasz-felismerés + kézi mód, másodpercenkénti frissítéssel. */
export function useTracking(sections: readonly Section[]) {
  const tracker = useRef<SectionTracker | null>(null);
  const manual = useRef(new ManualTracker());
  const [snapshot, setSnapshot] = useState<TrackerSnapshot | null>(null);
  const [manualSnap, setManualSnap] = useState<ManualSnapshot | null>(null);
  const [manualResult, setManualResult] = useState<ManualResult | null>(null);

  // Új szakaszlista (pl. a szerverről) a futó mérés megszakítása nélkül.
  useEffect(() => {
    if (!tracker.current) tracker.current = new SectionTracker(sections);
    else tracker.current.setSections(sections);
    setSnapshot(tracker.current.snapshot(Date.now()));
  }, [sections]);

  // Fix nélkül is frissítünk (alagútban a becslés miatt).
  useEffect(() => {
    const id = setInterval(() => {
      if (tracker.current) setSnapshot(tracker.current.tick(Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const onFix = useCallback((fix: GpsFix) => {
    if (tracker.current) setSnapshot(tracker.current.update(fix));
    if (manual.current.isRunning) setManualSnap(manual.current.addFix(fix));
  }, []);

  const toggleManual = useCallback(() => {
    if (manual.current.isRunning) {
      setManualResult(manual.current.stop(Date.now()));
      setManualSnap(null);
    } else {
      manual.current.start(Date.now());
      setManualResult(null);
      setManualSnap(manual.current.snapshot());
    }
  }, []);

  return { snapshot, onFix, manualSnap, manualResult, toggleManual };
}
