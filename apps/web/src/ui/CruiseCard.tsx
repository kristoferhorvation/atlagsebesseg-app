import { useEffect, useRef, useState } from 'react';
import { motion } from '@atlagsebesseg/design-tokens';
import type { CruiseCard as Model } from '@atlagsebesseg/app-logic';

/**
 * AW24: a krúzing-kártya a felső manőver-kártya helyén (iOS-pár: `UI/CruiseCardView.swift`, spec: `cruise-card`): égkék `cruiseCard` háttér, a kártya szegélye és árnyéka. Navigáció
 * indításakor a manőver-kártya felúszik, ez elhalványul: a kilépéshez az utolsó tartalom még egy animációnyi ideig kirajzolódik.
 */
export function CruiseCard({ card }: { card: Model }) {
  const last = useRef<Model>(card);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (card.kind !== 'hidden') {
      setLeaving(false);
      return;
    }
    if (last.current.kind === 'hidden') return;
    setLeaving(true);
    const id = setTimeout(() => {
      last.current = { kind: 'hidden' };
      setLeaving(false);
    }, motion.base);
    return () => clearTimeout(id);
  }, [card.kind]);
  if (card.kind !== 'hidden') last.current = card;
  const c = card.kind === 'hidden' ? last.current : card;
  if (c.kind === 'hidden' || (card.kind === 'hidden' && !leaving)) return null;
  return (
    <section className="cruise-card" data-testid="cruise-card" data-kind={c.kind} data-section={c.kind === 'full' && c.section !== null} data-leaving={leaving} role="status">
      {c.kind === 'full' ? (
        <>
          <div className="cruise-title">{c.title}</div>
          <div className="cruise-big">
            <b>{c.distance}</b>
            <span>{c.time}</span>
          </div>
          <div className="cruise-line">{c.line2}</div>
          {c.section && <div className="cruise-line cruise-section">{c.section}</div>}
        </>
      ) : (
        <div className="cruise-compact">{c.text}</div>
      )}
    </section>
  );
}
