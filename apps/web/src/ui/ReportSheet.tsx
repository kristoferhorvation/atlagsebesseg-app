import { isRowTile, REPORT_TONE, reportChoiceLabel, reportMenu, t, type ReportChoice } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const isGate = (c: ReportChoice) => c === 'kapu_kezdo' || c === 'kapu_zaro';

/**
 * Bejelentés: 1. koppintás megnyitja, 2. koppintás a típusra azonnal elküldi a jelenlegi
 * helyről (és irányból) – nincs megerősítő lépés. AW16: a menü alján az „Átlagmérés eleje / vége” egy-egy ideiglenes
 * kaput jelent be (ismeretlen mérési zóna); irány nélkül nem küldhető. AOS14 javítás: a kettő egy tétel – elküldött eleje
 * után ugyanaz a sor „vége” (`reportMenu`). AW18: az utolsó sorban a „Dugó” és a „Beállt” kis csempe a kapu-tétel mellett
 * (4 oszlop: 1 + 1 + 2) – a menü magassága nem nő.
 */
export function ReportSheet({
  fix,
  online,
  sending,
  gateStarted,
  onPick,
  onClose,
}: {
  fix: GpsFix | null;
  online: boolean;
  sending: ReportChoice | null;
  /** AOS14 javítás: az „Átlagmérés eleje” elküldve – az egyetlen kapu-tétel most „Átlagmérés vége”. */
  gateStarted: boolean;
  onPick: (c: ReportChoice) => void;
  onClose: () => void;
}) {
  const noHeading = fix !== null && fix.heading === null;
  const note = !online
    ? t('report.note.offline')
    : !fix
      ? t('report.note.noGps')
      : noHeading
        ? t('report.note.gateNoHeading')
        : gateStarted
          ? t('report.note.gateEnd')
          : t('report.note.default');
  const menu = reportMenu(gateStarted);
  const tile = (id: ReportChoice) => (
    <button
      key={isGate(id) ? 'kapu' : id}
      className={`tile${sending === id ? ' sending' : ''}${isGate(id) ? ' wide' : ''}${isRowTile(id) ? ' small' : ''}`}
      data-tone={REPORT_TONE[id]}
      data-gate={isGate(id) ? id : undefined}
      disabled={!online || !fix || sending !== null || (isGate(id) && noHeading)}
      onClick={() => onPick(id)}
    >
      <span className="ic">
        <Icon name={id} />
      </span>
      {reportChoiceLabel(id)}
    </button>
  );
  return (
    <Sheet title={t('report.title')} onClose={onClose}>
      {/* AW18: egy 4 oszlopos rács – felül 2 + 2, az utolsó sor 1 + 1 + 2 (Dugó, Beállt, kapu), így az oszlopok egymás alá esnek */}
      <div className="tiles tiles-4">{menu.map(tile)}</div>
      <div className="sheet-note">{note}</div>
    </Sheet>
  );
}
