import { useCallback, useEffect, useRef, useState } from 'react';
import { ReportFeed, reportQuery, type ActiveReport, type BBox } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import type { WebMapAdapter } from '../map';

/** Ilyen sűrűn nézzük, kell-e frissíteni (a lekérés maga 60 s-enként / nézetváltáskor megy). */
const CHECK_MS = 5000;

/**
 * Az aktív bejelentések a látható területen: lekérés a térkép téglalapja szerint (térkép nélkül a
 * pozíció körül), 60 s-enként frissítve; a saját bejelentés azonnal felkerül.
 */
export function useReports(map: WebMapAdapter, fix: GpsFix | null, fetch: (b: BBox) => Promise<ActiveReport[]>, now: () => number) {
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const [feed] = useState(() => new ReportFeed((b) => fetchRef.current(b), { now }));
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const view = useRef<BBox | null>(null);
  const fixRef = useRef(fix);
  fixRef.current = fix;

  const check = useCallback(() => {
    const q = reportQuery(view.current, fixRef.current);
    if (q && feed.shouldFetch(q)) void feed.refresh(q).then((changed) => changed && bump());
  }, [feed, bump]);

  useEffect(() => {
    map.setHandlers({
      onView: (b) => {
        view.current = b;
        check();
      },
    });
    // a lejártak eltűnése és a „12 perce” felirat miatt is újrarajzolunk
    const id = setInterval(() => {
      check();
      bump();
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [map, check, bump]);

  // az első pozíciónál azonnal (térkép nélkül ez az egyetlen jel)
  const hasFix = fix !== null;
  useEffect(() => {
    if (hasFix) check();
  }, [hasFix, check]);

  return {
    reports: feed.list(),
    addOwn: useCallback((r: ActiveReport) => (feed.addOwn(r), bump()), [feed, bump]),
    vote: useCallback((id: string, confirm: boolean) => (feed.vote(id, confirm), bump()), [feed, bump]),
    myVote: useCallback((id: string) => feed.myVote(id), [feed]),
    /** Új adatforrás (pl. a szimulátor mintái): azonnali újralekérés. */
    reload: useCallback(() => {
      const q = reportQuery(view.current, fixRef.current);
      if (q) void feed.refresh({ ...q, key: `${q.key}#${Date.now()}` }).then((changed) => changed && bump());
    }, [feed, bump]),
  };
}
