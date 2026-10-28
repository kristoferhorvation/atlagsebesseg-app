import { plannedDateRange, plannedIsZone, plannedLimitText, plannedZoneText, t, type PlannedCheck } from '@atlagsebesseg/app-logic';

/**
 * Felső, pulzáló sáv, amíg a felhasználó egy tervezett rendőrségi mérés vonalán halad:
 * „Tervezett rendőrségi mérés · okt 27–nov 2 · max 90” (+ időszak); zóna-típusú mérésnél (csak
 * települést közölt a rendőrség) a településen belül: „Rendőrségi mérés {település} területén · {dátum} ·
 * forrás: {forrás}”. Mérés közben (szakasz / kézi) kisebb, hogy a nagy számot ne zavarja. Mindig a DOM-ban
 * marad, a be/ki átmenet opacity + transform.
 */
export function PlannedBand({ check, compact }: { check: PlannedCheck | null; compact: boolean }) {
  return (
    <div className="planned-band glass" data-show={check !== null} data-compact={compact} data-zone={check !== null && plannedIsZone(check)} role="status" aria-live="polite" aria-hidden={check === null}>
      {check && (
        <>
          <span className="planned-band-dot" aria-hidden="true" />
          {plannedIsZone(check) ? (
            <span className="planned-band-text">
              <b>{plannedZoneText(check)}</b>
            </span>
          ) : (
            <span className="planned-band-text">
              <b>{t('planned.line')}</b>
              <span className="planned-band-meta">
                {plannedDateRange(check)} · <span className="planned-band-limit">{plannedLimitText(check)}</span>
                {check.timeWindow && <> · {check.timeWindow}</>}
              </span>
            </span>
          )}
        </>
      )}
    </div>
  );
}
