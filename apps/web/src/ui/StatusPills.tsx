import { t, type GpsPillAction } from '@atlagsebesseg/app-logic';
import type { WakeStatus } from '../hooks/useWakeLock';
import type { GeoStatus } from '../hooks/useGeolocation';
import { Icon, type IconName } from './Icon';

interface Pill {
  key: string;
  tone: string;
  icon?: IconName;
  text: string;
  onClick?: () => void;
}

/**
 * Felső állapotsor. Vezetés közben (`compact`) csak ikon + színes pötty – nincs apró szöveg;
 * figyelmeztetésnél (sárga/piros) a pötty színe beszél. A GPS-pill koppintása (AW13) a `gpsAction` szerint:
 * engedélykérés / a tiltott-lap / semmi (megadott engedélynél csak a pontosságot mutatja).
 */
export function StatusPills({
  geo,
  accuracy,
  wake,
  offline,
  simMode,
  compact,
  onWake,
  gpsAction,
  onGps,
}: {
  geo: GeoStatus;
  accuracy: number | null;
  wake: WakeStatus;
  offline: boolean;
  simMode: boolean;
  compact: boolean;
  onWake: () => void;
  gpsAction: GpsPillAction;
  onGps: () => void;
}) {
  const pills: Pill[] = [];
  if (simMode) pills.push({ key: 'sim', tone: 'kezi', icon: 'play', text: 'Szimulátor' });
  else {
    const gps: Record<GeoStatus, Omit<Pill, 'key'>> = {
      ki: { tone: 'semleges', icon: 'gps', text: t('pill.gps.off') },
      kereses: { tone: 'hataron', icon: 'gps', text: t('pill.gps.searching') },
      aktiv:
        accuracy !== null && accuracy > 25
          ? { tone: 'hataron', icon: 'gps', text: t('pill.gps.accuracy', { m: Math.round(accuracy) }) }
          : { tone: 'jo', icon: 'gps', text: accuracy !== null ? t('pill.gps.accuracy', { m: Math.round(accuracy) }) : t('pill.gps.active') },
      // a böngésző gesztus nélkül elutasított, de az engedély még kérhető (Mac Safari): koppintásra kér
      elutasitva: gpsAction === 'request' ? { tone: 'hataron', icon: 'gps', text: t('pill.gps.tap') } : { tone: 'tul', icon: 'gps', text: t('pill.gps.denied') },
      nem_elerheto: { tone: 'tul', icon: 'gps', text: t('pill.gps.unavailable') },
      hiba: { tone: 'tul', icon: 'gps', text: t('pill.gps.error') },
    };
    pills.push({ key: 'gps', ...gps[geo], onClick: gpsAction === 'none' ? undefined : onGps });
  }
  if (wake === 'aktiv') pills.push({ key: 'wake', tone: 'jo', icon: 'screen', text: t('pill.wake.on') });
  // csendes: a figyelmeztetés egyszer, induláskor jön (toast); itt csak semleges ikon
  else if (wake === 'inaktiv') pills.push({ key: 'wake', tone: 'semleges', icon: 'screen', text: t('pill.wake.tap'), onClick: onWake });
  else pills.push({ key: 'wake', tone: 'semleges', icon: 'screen', text: t('pill.wake.off'), onClick: onWake });
  if (offline) pills.push({ key: 'net', tone: 'semleges', text: t('pill.offline') });

  return (
    <div className={`pills${compact ? ' compact' : ''}`}>
      {pills.map((p) => {
        const inner = (
          <>
            {p.icon ? <Icon name={p.icon} size={18} /> : <span className="dot" />}
            <span className="pill-text">{p.text}</span>
          </>
        );
        return p.onClick ? (
          <button key={p.key} className="pill" data-tone={p.tone} onClick={p.onClick} aria-label={p.text}>
            {inner}
          </button>
        ) : (
          <div key={p.key} className="pill" data-tone={p.tone} aria-label={p.text}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
