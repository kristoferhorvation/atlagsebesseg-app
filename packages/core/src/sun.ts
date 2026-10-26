/**
 * Egyszerű napállás-számítás (a SunCalc / NOAA közelítő képletei alapján, ~1–2 perc pontosság).
 * Függőségmentes; a térkép világos/sötét előbeállításához használjuk.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const J0 = 0.0009;

const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS;

const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);

function eclipticLongitude(m: number): number {
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return m + c + RAD * 102.9372 + Math.PI;
}

const declination = (l: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
const rightAscension = (l: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));

export interface SunPosition {
  /** Magasság a horizont felett, fokban. */
  altitudeDeg: number;
  /** Óraszög fokban, (−180, 180]: negatív = délelőtt, pozitív = délután. */
  hourAngleDeg: number;
}

export function sunPosition(timeMs: number, lat: number, lon: number): SunPosition {
  const lw = -lon * RAD;
  const phi = lat * RAD;
  const d = toDays(timeMs);
  const l = eclipticLongitude(solarMeanAnomaly(d));
  const dec = declination(l);
  let h = RAD * (280.16 + 360.9856235 * d) - lw - rightAscension(l);
  h = Math.atan2(Math.sin(h), Math.cos(h));
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  return { altitudeDeg: altitude / RAD, hourAngleDeg: h / RAD };
}

export interface SunTimes {
  /** Polgári hajnal (−6°) – `null`, ha aznap nincs (sarki nappal/éjszaka). */
  civilDawn: number | null;
  sunrise: number | null;
  solarNoon: number;
  sunset: number | null;
  civilDusk: number | null;
}

/** Az adott időpont napjának (a helyi szoláris nap) napkelte/napnyugta időpontjai, Unix ms-ban. */
export function sunTimes(timeMs: number, lat: number, lon: number): SunTimes {
  const lw = -lon * RAD;
  const phi = lat * RAD;
  const d = toDays(timeMs);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const jNoon = J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);

  const at = (angleDeg: number): [number | null, number | null] => {
    const cosW = (Math.sin(angleDeg * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosW < -1 || cosW > 1) return [null, null];
    const w = Math.acos(cosW);
    const a = J0 + (w + lw) / (2 * Math.PI) + n;
    const jSet = J2000 + a + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
    const jRise = jNoon - (jSet - jNoon);
    return [fromJulian(jRise), fromJulian(jSet)];
  };

  const [sunrise, sunset] = at(-0.833);
  const [civilDawn, civilDusk] = at(-6);
  return { civilDawn, sunrise, solarNoon: fromJulian(jNoon), sunset, civilDusk };
}

export type SunPhase = 'nappal' | 'hajnal' | 'alkony' | 'ejszaka';

/**
 * Napszak a nap magassága alapján: ≥ 6° nappal, ≤ −6° (polgári szürkület vége) éjszaka,
 * a kettő között hajnal (délelőtt) vagy alkony (délután). Sarkvidéken is működik.
 */
export function sunPhase(timeMs: number, lat: number, lon: number): SunPhase {
  const { altitudeDeg, hourAngleDeg } = sunPosition(timeMs, lat, lon);
  if (altitudeDeg >= 6) return 'nappal';
  if (altitudeDeg <= -6) return 'ejszaka';
  return hourAngleDeg < 0 ? 'hajnal' : 'alkony';
}
