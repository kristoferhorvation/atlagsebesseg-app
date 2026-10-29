import type { SessionPhase } from '../session';

/**
 * AOS13: navigáció közben az alsó kártya-csoport (ajánlat, gombok, mérő- / eredménykártya) soha nem érhet a felső
 * lépés-kártya alá. Mérés közben a lépés mindig egysoros sáv a mérőkártya fölött; más fázisban (közeledés, a mérés
 * eredménye, megszakadás) akkor, ha a teljes felső kártya alja – térközzel – az alsó csoport teteje alá érne.
 *
 * A méréseket a nézet adja (képpont / pont, a képernyő tetejétől):
 * - `cardBottom`: a TELJES felső kártya alja (akkor is, ha éppen sáv látszik – a nézet a rejtett kártyát méri),
 * - `bottomTop`: az alsó csoport teteje a sáv NÉLKÜL (különben a sáv megjelenése visszakapcsolná a kártyát, és a kettő
 *   felváltva villogna).
 * Még nem mért értéknél (`null`) a teljes kártya marad – az első elrendezés után dől el.
 */
export interface NavStepLayout {
  measuring: boolean;
  cardBottom: number | null;
  bottomTop: number | null;
  /** A két csoport közti legkisebb térköz. */
  gap: number;
}

/** Egysoros sáv (`true`) vagy teljes felső kártya (`false`). */
export function navStepStrip({ measuring, cardBottom, bottomTop, gap }: NavStepLayout): boolean {
  if (measuring) return true;
  if (cardBottom === null || bottomTop === null) return false;
  return cardBottom + gap > bottomTop;
}

/**
 * AOS13: navigáció közben a mérés eredménye (`befejezve`) egysoros, kompakt kártya: a nagy kártya a gombsorral együtt a
 * felső lépés-kártya – sávként is a pillek – alá érne. A kézi mérés eredménye nagy marad (a kapu-küldés állapota és
 * az „Újra” gomb nem fér egy sorba); ott a felső kártya sávvá zsugorodik, ha kell (`navStepStrip`).
 */
export function navResultCompact(phase: SessionPhase, navigating: boolean): boolean {
  return navigating && phase === 'befejezve';
}
