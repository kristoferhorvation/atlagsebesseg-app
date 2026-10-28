import { plannedDateRange, plannedLimitText, type PlannedCheck } from '@atlagsebesseg/app-logic';

/**
 * Felső, pulzáló sáv, amíg a felhasználó egy tervezett rendőrségi mérés vonalán halad:
 * „Tervezett rendőrségi mérés · okt 27–nov 2 · max 90” (+ időszak). Mérés közben (szakasz / kézi)
 * kisebb, hogy a nagy számot ne zavarja. Mindig a DOM-ban marad, a be/ki átmenet opacity + transform.
 */
export function PlannedBand({ check, compact }: { check: PlannedCheck | null; compact: boolean }) {
  return (
    <div className="planned-band glass" data-show={check !== null} data-compact={compact} role="status" aria-live="polite" aria-hidden={check === null}>
      {check && (
        <>
          <span className="planned-band-dot" aria-hidden="true" />
          <span className="planned-band-text">
            <b>Tervezett rendőrségi mérés</b>
            <span className="planned-band-meta">
              {plannedDateRange(check)} · <span className="planned-band-limit">{plannedLimitText(check)}</span>
              {check.timeWindow && <> · {check.timeWindow}</>}
            </span>
          </span>
        </>
      )}
    </div>
  );
}
