import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '@atlagsebesseg/app-logic';
import { Icon } from './Icon';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Indítás: egy koppintás kéri a helyhozzáférést és a kijelző ébren tartását (gesztus kell hozzá). */
export function StartScreen({ onStart }: { onStart: () => void }) {
  const showInstallHint = isIos() && !isStandalone();
  // AOS17: a cím soha nem törik és nem vágódik le: ha nem fér ki egy sorban (DE: „Durchschnittstempo”), a betű kisebb
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleSize, setTitleSize] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const fit = () => {
      const el = titleRef.current;
      if (!el) return;
      el.style.fontSize = '';
      const full = parseFloat(getComputedStyle(el).fontSize);
      setTitleSize(el.scrollWidth > el.clientWidth ? (full * el.clientWidth) / el.scrollWidth : undefined);
    };
    fit();
    void document.fonts?.ready.then(fit);
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return (
    <div className="start">
      <img className="start-mark" src="/icons/icon-192.png" alt="" />
      <div>
        <h1 ref={titleRef} style={{ fontSize: titleSize }}>
          {t('app.name')}
        </h1>
        <p style={{ marginTop: 10 }}>{t('start.tagline')}</p>
      </div>
      <ul>
        <li>
          <Icon name="check" /> {t('start.tip.phone')}
        </li>
        <li>
          <Icon name="check" /> {t('start.tip.location')}
        </li>
        <li>
          <Icon name="check" /> {t('start.tip.foreground')}
        </li>
      </ul>
      {showInstallHint && (
        <div className="hint-card glass">
          <b>{t('start.install.title')}</b> {t('start.install.steps')}
        </div>
      )}
      <button className="btn primary" onClick={onStart}>
        {t('start.go')}
      </button>
      <a className="link-btn" href="/?sim" style={{ textAlign: 'center', textDecoration: 'none' }}>
        {t('start.sim')}
      </a>
    </div>
  );
}
