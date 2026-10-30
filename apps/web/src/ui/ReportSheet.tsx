import { REPORT_CHOICES, REPORT_TONE, reportChoiceLabel, t, type ReportChoice } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const isGate = (c: ReportChoice) => c === 'kapu_kezdo' || c === 'kapu_zaro';

/**
 * Bejelentés: 1. koppintás megnyitja, 2. koppintás a típusra azonnal elküldi a jelenlegi
 * helyről (és irányból) – nincs megerősítő lépés. AW16: a menü alján az „Átlagmérés eleje / vége” egy-egy ideiglenes
 * kaput jelent be (ismeretlen mérési zóna); irány nélkül nem küldhető.
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
  const noHeading = fix !== null && fix.heading === null;
  const note = !online ? t('report.note.offline') : !fix ? t('report.note.noGps') : noHeading ? t('report.note.gateNoHeading') : t('report.note.default');
  return (
    <Sheet title={t('report.title')} onClose={onClose}>
      <div className="tiles">
        {REPORT_CHOICES.map((c) => (
          <button
            key={c.id}
            className={`tile${sending === c.id ? ' sending' : ''}${isGate(c.id) ? ' wide' : ''}`}
            data-tone={REPORT_TONE[c.id]}
            disabled={!online || !fix || sending !== null || (isGate(c.id) && noHeading)}
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
