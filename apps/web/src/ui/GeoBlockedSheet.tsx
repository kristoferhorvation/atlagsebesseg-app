import { deniedHelpSteps, t, type BrowserKind } from '@atlagsebesseg/app-logic';
import { Sheet } from './Sheet';

/**
 * Tiltott helyhozzáférés (AW13): kis lap a bekapcsolás útjával a felismert böngészőre (iOS Safari / Mac Safari / Chrome /
 * Android Chrome / egyéb), és „Újrapróbálás” – a feloldás után ez kér újra (a gomb gesztusa a kéréshez tartozik).
 */
export function GeoBlockedSheet({ browser, onRetry, onClose }: { browser: BrowserKind; onRetry: () => void; onClose: () => void }) {
  return (
    <Sheet title={t('geo.blocked.title')} onClose={onClose}>
      <div className="geo-help" data-browser={browser}>
        <p>{t('geo.blocked.intro')}</p>
        <ol>
          {deniedHelpSteps(browser).map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
        <button className="btn primary" onClick={onRetry}>
          {t('geo.blocked.retry')}
        </button>
      </div>
    </Sheet>
  );
}
