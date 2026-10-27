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
  kapu_kezdo: 'jo',
  kapu_zaro: 'jo',
};

/**
 * Bejelentés: 1. koppintás megnyitja, 2. koppintás a típusra azonnal elküldi a jelenlegi
 * helyről (és irányból) – nincs megerősítő lépés.
 */
export function ReportSheet({
  fix,
  online,
  sending,
  onPick,
  onClose,
}: {
  fix: GpsFix | null;
  online: boolean;
  sending: ReportChoice | null;
  onPick: (c: ReportChoice) => void;
  onClose: () => void;
}) {
  const note = !online
    ? 'Nincs szerver-beállítás – a bejelentés most nem küldhető.'
    : !fix
      ? 'Nincs még GPS-helyzet.'
      : fix.heading === null
        ? 'Az ideiglenes kapuhoz mozgás közbeni irány kell.'
        : 'A jelenlegi helyed és haladási irányod kerül a bejelentésbe.';
  return (
    <Sheet title="Bejelentés" onClose={onClose}>
      <div className="tiles">
        {REPORT_CHOICES.map((c) => (
          <button
            key={c.id}
            className={`tile${sending === c.id ? ' sending' : ''}`}
            data-tone={TONE[c.id]}
            disabled={!online || !fix || (c.needsHeading && fix.heading === null) || sending !== null}
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
