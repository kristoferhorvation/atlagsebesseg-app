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
        <h1>Átlagsebesség</h1>
        <p style={{ marginTop: 10 }}>Mérőszakaszon automatikusan indul: élő átlag, határ és egyértelmű színkód.</p>
      </div>
      <ul>
        <li>
          <Icon name="check" /> Telefon tartóban, képernyő bekapcsolva
        </li>
        <li>
          <Icon name="check" /> Helyhozzáférés engedélyezése
        </li>
        <li>
          <Icon name="check" /> Az app maradjon előtérben – háttérben a mérés megszakad
        </li>
      </ul>
      {showInstallHint && (
        <div className="hint-card glass">
          <b>Tedd a kezdőképernyőre:</b> Megosztás gomb → „Főképernyőhöz adás”. Így teljes képernyőn, címsor nélkül fut.
        </div>
      )}
      <button className="btn primary" onClick={onStart}>
        Indulás
      </button>
      <a className="link-btn" href="/?sim" style={{ textAlign: 'center', textDecoration: 'none' }}>
        Kipróbálom GPS nélkül (szimulátor)
      </a>
    </div>
  );
}
