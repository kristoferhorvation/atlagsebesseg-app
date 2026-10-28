import { t } from '@atlagsebesseg/app-logic';
import { Icon } from './Icon';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Indítás: egy koppintás kéri a helyhozzáférést és a kijelző ébren tartását (gesztus kell hozzá). */
export function StartScreen({ onStart }: { onStart: () => void }) {
  const showInstallHint = isIos() && !isStandalone();
  return (
    <div className="start">
      <img className="start-mark" src="/icons/icon-192.png" alt="" />
      <div>
        <h1>{t('app.name')}</h1>
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
