import { t } from '@atlagsebesseg/app-logic';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Alulról felcsúszó lap háttérrel; Escape / háttér-koppintás bezárja. */
export function Sheet({ title, onClose, peek, onPeekEnd, children }: { title: string; onClose: () => void; peek?: boolean; onPeekEnd?: () => void; children: ReactNode }) {
  // a lap zsugorodása / a választó beigazítása is görgetésnek látszik: a peek első 0,9 s-ában nem számít
  const peekAt = useRef(0);
  useEffect(() => {
    if (peek) peekAt.current = Date.now();
  }, [peek]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} data-peek={peek ? 'true' : undefined} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} data-peek={peek ? 'true' : undefined} onScroll={peek ? () => Date.now() - peekAt.current > 900 && onPeekEnd?.() : undefined}>
        <div className="sheet-head">
          <div className="title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
