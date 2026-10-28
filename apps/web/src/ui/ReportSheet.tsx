import { REPORT_CHOICES, REPORT_TONE, reportChoiceLabel, t, type ReportChoice } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

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
  const note = !online ? t('report.note.offline') : !fix ? t('report.note.noGps') : t('report.note.default');
  return (
    <Sheet title={t('report.title')} onClose={onClose}>
      <div className="tiles">
        {REPORT_CHOICES.map((c) => (
          <button
            key={c.id}
            className={`tile${sending === c.id ? ' sending' : ''}${c.id === 'ideiglenes_szakasz' ? ' wide' : ''}`}
            data-tone={REPORT_TONE[c.id]}
            disabled={!online || !fix || sending !== null || (c.id === 'ideiglenes_szakasz' && manualRunning)}
            onClick={() => onPick(c.id)}
          >
            <span className="ic">
              <Icon name={c.id} />
            </span>
            {reportChoiceLabel(c.id)}
          </button>
        ))}
      </div>
      <div className="sheet-note">{note}</div>
    </Sheet>
  );
}
