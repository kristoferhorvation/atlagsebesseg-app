/** km/h ↔ m/s */
export const kmhToMps = (kmh: number) => kmh / 3.6;
export const mpsToKmh = (mps: number) => mps * 3.6;

export const DEFAULT_MIN_PRACTICAL_FRACTION = 0.6;

/** Átlagsebesség km/h-ban; `null`, ha még nincs értelmezhető adat. */
export function averageSpeedKmh(distanceM: number, elapsedMs: number): number | null {
  if (elapsedMs < 1000 || distanceM <= 0) return null;
  return mpsToKmh(distanceM / (elapsedMs / 1000));
}

export interface RequiredSpeedInput {
  lengthM: number;
  speedLimitKmh: number;
  distanceDoneM: number;
  elapsedMs: number;
  /**
   * A határ ekkora hányadánál kisebb megengedett sebességet már nem tekintünk reálisnak
   * (hirtelen lassítás veszélyes). Alapértelmezés: 0,6 (130-as határnál 78 km/h).
   */
  minPracticalFraction?: number;
}

export type RequiredSpeed =
  /** A hátralévő úton legfeljebb `maxKmh` sebességgel haladhatsz. */
  | { kind: 'ok'; maxKmh: number }
  /** Már annyi idő eltelt, hogy bármilyen sebesség mellett a határ alatt maradsz. */
  | { kind: 'nincs_korlat' }
  /** Csak `maxKmh`-nál lassabban lehetne a határ alá kerülni, ami nem reális (vagy már célba értél). */
  | { kind: 'nem_lehetseges'; maxKmh: number };

/**
 * Mekkora sebességgel kell (legfeljebb) megtenni a hátralévő utat, hogy a szakasz
 * végén az átlag ≤ határ legyen.
 *
 * Feltétel: teljes idő ≥ hossz / határ, azaz
 *   hátralévő_idő ≥ hossz / határ − eltelt_idő,
 *   v_max = hátralévő_út / (hossz / határ − eltelt_idő).
 */
export function requiredSpeed(input: RequiredSpeedInput): RequiredSpeed {
  const { lengthM, speedLimitKmh, distanceDoneM, elapsedMs } = input;
  const minPractical = speedLimitKmh * (input.minPracticalFraction ?? DEFAULT_MIN_PRACTICAL_FRACTION);
  const remainingM = Math.max(0, lengthM - distanceDoneM);
  const minTotalS = lengthM / kmhToMps(speedLimitKmh);
  const budgetS = minTotalS - elapsedMs / 1000;
  if (budgetS <= 0) return { kind: 'nincs_korlat' };
  if (remainingM <= 0) return { kind: 'nem_lehetseges', maxKmh: 0 };
  const maxKmh = mpsToKmh(remainingM / budgetS);
  return maxKmh < minPractical ? { kind: 'nem_lehetseges', maxKmh } : { kind: 'ok', maxKmh };
}

/** Mennyivel kell lassítani a jelenlegi sebességhez képest (km/h, ≥ 0). */
export function slowDownByKmh(currentKmh: number | null, req: RequiredSpeed): number | null {
  if (currentKmh === null) return null;
  if (req.kind === 'nincs_korlat') return 0;
  return Math.max(0, currentKmh - req.maxKmh);
}

export interface ToleranceRule {
  /** Százalékos tűrés (pl. 5 = 5%). */
  percent: number;
  /** Legalább ennyi km/h tűrés. */
  minKmh: number;
}

/** Olasz Tutor gyakorlat: 5%, de legalább 5 km/h (a nagyobb). */
export const DEFAULT_TOLERANCE: ToleranceRule = { percent: 5, minKmh: 5 };

/** A hatósági mérési tűrés km/h-ban: max(határ × %, minimum). */
export function toleranceKmh(speedLimitKmh: number, rule: ToleranceRule = DEFAULT_TOLERANCE): number {
  return Math.max((speedLimitKmh * rule.percent) / 100, rule.minKmh);
}

/**
 * Határ + tűrés – CSAK megjelenítésre. A „szükséges sebesség” és a figyelmeztetés
 * mindig a szigorú határhoz számol.
 */
export function limitWithToleranceKmh(speedLimitKmh: number, rule: ToleranceRule = DEFAULT_TOLERANCE): number {
  return speedLimitKmh + toleranceKmh(speedLimitKmh, rule);
}
