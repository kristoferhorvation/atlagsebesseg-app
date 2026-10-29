import type { SessionPhase } from '../session';
import { MANUAL_PILL } from './config';

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
 * felső lépés-kártya – sávként is a pillek – alá érne. AW15: a kézi mérés eredménye (`kezi_eredmeny`) is; kapu-küldési
 * hibánál a sor végén kis „Újra” gomb, nagy kártya nélkül.
 */
export function navResultCompact(phase: SessionPhase, navigating: boolean): boolean {
  return navigating && (phase === 'befejezve' || phase === 'kezi_eredmeny');
}

/**
 * AW15: a kézi mérés kártyája navigáció közben. Pill (`collapsed`) vagy teljes kártya; az 5 s a teljes kártya
 * kinyílásától számít (`expandedAt`, ms); a `space` az előző lépés „a navigációnak hely kell” értéke (az élhez).
 */
export interface ManualPillState {
  collapsed: boolean;
  expandedAt: number;
  space: boolean;
}

/** A navigáció helyigénye: közeli manőver (`maneuverNearM`-en belül), ajánlat-kártya vagy közeli kamera. */
export function navNeedsSpace(v: { maneuverM: number | null; offer: boolean; cameraNear: boolean }): boolean {
  return v.offer || v.cameraNear || (v.maneuverM !== null && v.maneuverM < MANUAL_PILL.maneuverNearM);
}

/**
 * Óra-lépés (bármikor hívható, pl. minden fixnél és időzítőről). `active`: navigáció közben fut a kézi mérés – nélküle
 * nincs pill (`null`: a mostani nagy kártya). Induláskor teljes kártya; `collapseAfterMs` után, vagy amikor a navigációnak
 * hely kell (felfutó él – ha a felhasználó közben kinyitja, 5 s-ig nyitva marad), összemegy.
 */
export function manualPillTick(s: ManualPillState | null, active: boolean, space: boolean, now: number): ManualPillState | null {
  if (!active) return null;
  const prev = s ?? { collapsed: false, expandedAt: now, space: false };
  const collapse = !prev.collapsed && ((space && !prev.space) || now - prev.expandedAt >= MANUAL_PILL.collapseAfterMs);
  if (!collapse && s && s.space === space) return s;
  return { collapsed: prev.collapsed || collapse, expandedAt: prev.expandedAt, space };
}

/** Bökés: a pill kinyílik (az 5 s újraindul), a teljes kártya összemegy. */
export function manualPillTap(s: ManualPillState, now: number): ManualPillState {
  return s.collapsed ? { ...s, collapsed: false, expandedAt: now } : { ...s, collapsed: true };
}
