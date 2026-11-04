import { useLayoutEffect, useRef, useState } from 'react';
import { HAZARD_KINDS, hazardLabel, MAP_ERROR_KINDS, mapErrorHint, mapErrorLabel, REPORT_TONE, reportChoiceLabel, reportMenu, t, type HazardKind, type MapErrorKind, type ReportChoice, type ReportSubtype } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const isGate = (c: ReportChoice) => c === 'kapu_kezdo' || c === 'kapu_zaro';

/**
 * Bejelentés: 1. koppintás megnyitja, 2. koppintás a típusra azonnal elküldi a jelenlegi
 * helyről (és irányból) – nincs megerősítő lépés. AW16: a menü alján az „Átlagmérés eleje / vége” egy-egy ideiglenes
 * kaput jelent be (ismeretlen mérési zóna); irány nélkül nem küldhető. AOS14 javítás: a kettő egy tétel – elküldött eleje
 * után ugyanaz a sor „vége” (`reportMenu`). AW18: az utolsó sorban a „Dugó” és a „Beállt” kis csempe a kapu-tétel mellett
 * (4 oszlop: 1 + 1 + 2) – a menü magassága nem nő. AOS17: a csempék az A5-ös méreten (2 oszlop, 76 px, 44 px-es ikon, 18 px-es
 * felirat, elválasztás nélkül); a „Térképhiba” második választót nyit, a küldés a lap első koppintásakori helyről megy. AW22: a „Veszély” ugyanígy (Tárgy az úton · Kátyú · Álló jármű).
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
  onPick: (c: ReportChoice, opts?: { subtype: ReportSubtype; fix: GpsFix }) => void;
  onClose: () => void;
}) {
  const [mapErrorFix, setMapErrorFix] = useState<GpsFix | null>(null);
  const [hazardFix, setHazardFix] = useState<GpsFix | null>(null);
  // AOS17: szó közben nem törünk – ha a felirat leghosszabb szava nem fér ki, csak annak a csempének a betűje kisebb (mint iOS-en a minimumScaleFactor)
  const tilesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      for (const el of tilesRef.current?.querySelectorAll<HTMLElement>('.tile-label') ?? []) {
        el.style.fontSize = '';
        if (el.scrollWidth > el.clientWidth) el.style.fontSize = `${Math.floor((parseFloat(getComputedStyle(el).fontSize) * el.clientWidth * 10) / el.scrollWidth) / 10}px`;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, [gateStarted, mapErrorFix, hazardFix]);
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
      className={`tile${sending === id ? ' sending' : ''}${isGate(id) ? ' wide' : ''}`}
      data-tone={REPORT_TONE[id]}
      data-gate={isGate(id) ? id : undefined}
      disabled={!online || !fix || sending !== null || (isGate(id) && noHeading)}
      onClick={() => (id === 'szakasz_hiba' ? setMapErrorFix(fix) : id === 'akadaly' ? setHazardFix(fix) : onPick(id))}
    >
      <span className="ic">
        <Icon name={id} />
      </span>
      <span className="tile-label">{reportChoiceLabel(id)}</span>
    </button>
  );
  if (mapErrorFix)
    return (
      <Sheet title={reportChoiceLabel('szakasz_hiba')} onClose={onClose}>
        <div className="group-label map-error-q">{t('report.sub.question')}</div>
        <div className="list" data-testid="map-error-list">
          {MAP_ERROR_KINDS.map((k) => (
            <button key={k} className="list-row nav-row" data-kind={k} disabled={sending !== null} onClick={() => onPick('szakasz_hiba', { subtype: k, fix: mapErrorFix })}>
              <div>
                <div className="label">{mapErrorLabel(k)}</div>
                {mapErrorHint(k) && <div className="hint">{mapErrorHint(k)}</div>}
              </div>
              <Icon name="chevronRight" size={20} />
            </button>
          ))}
        </div>
      </Sheet>
    );
  if (hazardFix)
    return (
      <Sheet title={reportChoiceLabel('akadaly')} onClose={onClose}>
        <div className="group-label map-error-q">{t('report.hazard.question')}</div>
        <div className="list" data-testid="hazard-list">
          {HAZARD_KINDS.map((k: HazardKind) => (
            <button key={k} className="list-row nav-row" data-kind={k} disabled={sending !== null} onClick={() => onPick('akadaly', { subtype: k, fix: hazardFix })}>
              <div>
                <div className="label">{hazardLabel(k)}</div>
              </div>
              <Icon name="chevronRight" size={20} />
            </button>
          ))}
        </div>
      </Sheet>
    );
  return (
    <Sheet title={t('report.title')} onClose={onClose}>
      <div className="tiles" ref={tilesRef}>
        {menu.map(tile)}
      </div>
      <div className="sheet-note">{note}</div>
    </Sheet>
  );
}
