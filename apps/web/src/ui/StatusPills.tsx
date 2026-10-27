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
 * figyelmeztetésnél (sárga/piros) a pötty színe beszél.
 */
export function StatusPills({
  geo,
  accuracy,
  wake,
  offline,
  simMode,
  compact,
  onWake,
}: {
  geo: GeoStatus;
  accuracy: number | null;
  wake: WakeStatus;
  offline: boolean;
  simMode: boolean;
  compact: boolean;
  onWake: () => void;
}) {
  const pills: Pill[] = [];
  if (simMode) pills.push({ key: 'sim', tone: 'kezi', icon: 'play', text: 'Szimulátor' });
  else {
    const gps: Record<GeoStatus, Omit<Pill, 'key'>> = {
      ki: { tone: 'semleges', icon: 'gps', text: 'GPS ki' },
      kereses: { tone: 'hataron', icon: 'gps', text: 'GPS keresése…' },
      aktiv:
        accuracy !== null && accuracy > 25
          ? { tone: 'hataron', icon: 'gps', text: `GPS ±${Math.round(accuracy)} m` }
          : { tone: 'jo', icon: 'gps', text: accuracy !== null ? `GPS ±${Math.round(accuracy)} m` : 'GPS' },
      elutasitva: { tone: 'tul', icon: 'gps', text: 'Helyhozzáférés tiltva' },
      nem_elerheto: { tone: 'tul', icon: 'gps', text: 'Nincs GPS (HTTPS kell)' },
      hiba: { tone: 'tul', icon: 'gps', text: 'GPS-hiba' },
    };
    pills.push({ key: 'gps', ...gps[geo] });
  }
  if (wake === 'aktiv') pills.push({ key: 'wake', tone: 'jo', icon: 'screen', text: 'Kijelző ébren' });
  else if (wake === 'inaktiv') pills.push({ key: 'wake', tone: 'hataron', icon: 'screen', text: 'Kijelző elalhat – koppints', onClick: onWake });
  else pills.push({ key: 'wake', tone: 'hataron', icon: 'screen', text: 'Kijelző elalhat', onClick: onWake });
  if (offline) pills.push({ key: 'net', tone: 'semleges', text: 'Offline · beépített szakaszok' });

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
