/** km/h ↔ m/s */
export const kmhToMps = (kmh: number) => kmh / 3.6;
export const mpsToKmh = (mps: number) => mps * 3.6;

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
   * Ennél kisebb megengedett sebességet már nem tekintünk reálisnak autópályán
   * (hirtelen lassítás veszélyes). Alapértelmezés: 60 km/h.
   */
  minPracticalKmh?: number;
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
  const minPractical = input.minPracticalKmh ?? 60;
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
