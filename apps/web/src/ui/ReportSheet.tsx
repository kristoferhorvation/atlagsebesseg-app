import { REPORT_CHOICES, type ReportChoice } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const TONE: Record<ReportChoice, string> = {
  rendorseg: 'kezi',
  traffipax: 'hataron',
  baleset: 'tul',
  akadaly: 'hataron',
  utlezaras: 'tul',
  szakasz_hiba: 'semleges',
  ideiglenes_szakasz: 'kezi',
};

/**
 * Bejelentés: 1. koppintás megnyitja, 2. koppintás a típusra azonnal elküldi a jelenlegi
 * helyről (és irányból) – nincs megerősítő lépés. Az „Ideiglenes szakasz kezdete” a kézi mérést
 * is elindítja (és bejelenti a kezdő kaput); a záró kaput a mérés „Vége” gombja küldi.
 */
export function ReportSheet({
  fix,
  online,
  sending,
  manualRunning,
  onPick,
  onClose,
}: {
  fix: GpsFix | null;
  online: boolean;
  sending: ReportChoice | null;
  /** Fut már kézi mérés – ilyenkor nem indítható ideiglenes szakasz. */
  manualRunning: boolean;
  onPick: (c: ReportChoice) => void;
  onClose: () => void;
}) {
  const note = !online
    ? 'Nincs szerver-beállítás – a bejelentés most nem küldhető.'
    : !fix
      ? 'Nincs még GPS-helyzet.'
      : 'A jelenlegi helyed és haladási irányod kerül a bejelentésbe. Ideiglenes szakasz: a mérés végén a „Vége” gomb jelenti be a záró kaput.';
  return (
    <Sheet title="Bejelentés" onClose={onClose}>
      <div className="tiles">
        {REPORT_CHOICES.map((c) => (
          <button
            key={c.id}
            className={`tile${sending === c.id ? ' sending' : ''}${c.id === 'ideiglenes_szakasz' ? ' wide' : ''}`}
            data-tone={TONE[c.id]}
            disabled={!online || !fix || sending !== null || (c.id === 'ideiglenes_szakasz' && manualRunning)}
            onClick={() => onPick(c.id)}
          >
            <span className="ic">
              <Icon name={c.id} />
            </span>
            {c.label}
          </button>
        ))}
      </div>
      <div className="sheet-note">{note}</div>
    </Sheet>
  );
}
