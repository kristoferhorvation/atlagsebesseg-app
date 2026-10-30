import { angleDiffDeg, Route, type GpsFix, type LatLon } from '@atlagsebesseg/core';
import { t } from '../i18n';
import { ROUTE_MATCH_M } from './config';
import { DirectionsError } from './directions';
import type { NavRoute } from './types';

/**
 * AW18: forgalom navigáció közben, helyi dugó-érzékelés, közösségi dugó-adat, újratervezés-újrapróbálás.
 * - `refreshMs`: friss driving-traffic lekérés ennyi időnként (a 2 perces alternatíva-figyeléssel közös hívás).
 * - `delayShowS`: a „+N perc dugó” ennyi késéstől (a friss ETA az indulási tervhez képest); a hang csak az első
 *   alkalommal szól, a további növekedésnél a sáv némán frissül.
 * - Dugó-állapot: a `jamWindowMs` ablak mért átlaga a várt tempó `jamSlowFraction`-ja alatt; vége, ha legalább
 *   `jamClearM`-en át a várt tempó `jamNearFraction`-ja fölött halad (a lámpák közti rövidebb gyorsulás nem szakítja meg).
 * - A „Dugóba kerültél?” kártya `jamPromptMs` után válasz nélkül eltűnik.
 * - A dugós ETA a következő manőverig legfeljebb `jamAheadMaxM`-en a mért átlaggal (legalább `jamMinKmh`), onnan tervezett.
 * - Dugó közben `jamUploadMs`-enként új közösségi minta; a közösségi adat `communityMaxAgeMs`-ig él, a bejelentett minta
 *   hossza `reportedLengthM`.
 * - Újratervezés-hiba után a következő próba `rerouteBackoffS` szerint (a végén maradó érték ismétlődik); a lekérés
 *   `directionsTimeoutMs` után időtúllépés.
 */
export const TRAFFIC = {
  refreshMs: 120_000,
  delayShowS: 180,
  jamWindowMs: 120_000,
  jamSlowFraction: 0.5,
  jamNearFraction: 0.8,
  jamClearM: 500,
  jamPromptMs: 15_000,
  jamAheadMaxM: 3000,
  jamMinKmh: 5,
  jamUploadMs: 120_000,
  communityMaxAgeMs: 15 * 60_000,
  communityHeadingDeg: 45,
  reportedLengthM: 300,
  rerouteBackoffS: [5, 10, 20, 30],
  directionsTimeoutMs: 10_000,
} as const;

// ---------------------------------------------------------------------------
// Útvonalválasztó
// ---------------------------------------------------------------------------

/** A „Leggyorsabb”: a legkisebb menetidejű útvonal indexe (egyenlőnél az előbbi); üres listánál 0. */
export function fastestRouteIndex(durationsS: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < durationsS.length; i++) if (durationsS[i]! < durationsS[best]!) best = i;
  return best;
}

/** A kártya címkéje: a leggyorsabbon „Leggyorsabb”, a többin „Alternatíva N” (N a leggyorsabb nélküli sorszám). */
export function routeTagText(index: number, fastest: number): string {
  if (index === fastest) return t('nav.picker.fastest');
  return t('nav.picker.alt', { n: index < fastest ? index + 1 : index });
}

// ---------------------------------------------------------------------------
// Újratervezés-hiba
// ---------------------------------------------------------------------------

/** A `failures`. sikertelen újratervezés után ennyi idő múlva jön a következő próba (ms): 5 → 10 → 20 → 30 s, max 30. */
export function rerouteRetryDelayMs(failures: number): number {
  const b = TRAFFIC.rerouteBackoffS;
  return b[Math.min(b.length - 1, Math.max(0, failures - 1))]! * 1000;
}

/** A Directions-hiba oka a naplóhoz: HTTP-státusz (`http_503`), `timeout`, `network`, vagy a Directions kódja (`NoRoute`). */
export function routeErrorKind(e: unknown): string {
  if (e instanceof DirectionsError) return e.code;
  if (e instanceof TypeError) return 'network';
  return e instanceof Error && e.message ? `network: ${e.message}` : 'network';
}

// ---------------------------------------------------------------------------
// Helyi dugó-érzékelés
// ---------------------------------------------------------------------------

export type JamChange = 'enter' | 'exit' | null;

/**
 * Dugó-állapot a mért haladásból. A megtett utat az útvonal menti legtávolabbi elért pont növekedése adja (álló
 * helyzetben az oda-vissza GPS-zaj nem „halad”); útvonal-csere után `rebase()`. Belépés: legalább `jamWindowMs` adat, és az ablak átlaga a várt tempó
 * `jamSlowFraction`-ja alatt. Kilépés: legalább `jamClearM` megszakítás nélkül a várt tempó `jamNearFraction`-ja fölött.
 */
export class JamDetector {
  private odo = 0;
  /** Az útvonal mentén eddig elért legtávolabbi pont: csak ennek növekedése haladás (a zaj oda-vissza nem). */
  private maxAlong: number | null = null;
  private hist: { t: number; odo: number }[] = [];
  private jam = false;
  private clear: { odo: number; t: number } | null = null;
  private lastClearAvg: number | null = null;

  /** Új fix: `t` (ms), útvonal menti hely (m), pillanatnyi sebesség (m/s; `null`: a haladásból), várt tempó (m/s). */
  update(t: number, alongM: number, speedMps: number | null, expectedMps: number): JamChange {
    const prev = this.hist.at(-1);
    if (this.maxAlong !== null) this.odo += Math.max(0, alongM - this.maxAlong);
    this.maxAlong = Math.max(this.maxAlong ?? alongM, alongM);
    this.hist.push({ t, odo: this.odo });
    while (this.hist.length > 2 && this.hist[1]!.t <= t - TRAFFIC.jamWindowMs) this.hist.shift();
    const speed = speedMps ?? (prev && t > prev.t ? ((this.odo - prev.odo) * 1000) / (t - prev.t) : 0);
    if (!this.jam) {
      const avg = this.avgMps;
      const span = t - this.hist[0]!.t;
      if (avg !== null && span >= TRAFFIC.jamWindowMs - 1000 && avg < TRAFFIC.jamSlowFraction * expectedMps) {
        this.jam = true;
        this.clear = null;
        return 'enter';
      }
      return null;
    }
    if (speed >= TRAFFIC.jamNearFraction * expectedMps) {
      this.clear ??= { odo: this.odo, t };
      if (this.odo - this.clear.odo >= TRAFFIC.jamClearM) {
        this.lastClearAvg = t > this.clear.t ? ((this.odo - this.clear.odo) * 1000) / (t - this.clear.t) : speed;
        this.jam = false;
        this.clear = null;
        // a dugós ablak ne indítson azonnal újra
        this.hist = [{ t, odo: this.odo }];
        return 'exit';
      }
    } else this.clear = null;
    return null;
  }

  /** Új útvonal: a hely mostantól az új útvonalon mérődik (a megtett út megmarad). */
  rebase(): void {
    this.maxAlong = null;
  }

  get active(): boolean {
    return this.jam;
  }

  /** Az utolsó (legfeljebb `jamWindowMs`-os) ablak átlaga (m/s); egy mintánál `null`. */
  get avgMps(): number | null {
    const a = this.hist[0];
    const b = this.hist.at(-1);
    if (!a || !b || b.t <= a.t) return null;
    return ((b.odo - a.odo) * 1000) / (b.t - a.t);
  }

  /** A dugó végét jelző szakasz átlaga (m/s) – a „feloldva” közösségi mintához. */
  get clearedAvgMps(): number | null {
    return this.lastClearAvg;
  }

  /** A megtett út (m) – a minta hosszához. */
  get odometerM(): number {
    return this.odo;
  }
}

// ---------------------------------------------------------------------------
// Közösségi dugó-adat
// ---------------------------------------------------------------------------

/** A `public.jam_kind` enum: érzékelt / bejelentett dugó, illetve a feloldódás (normál tempó újra). */
export type JamKind = 'erzekelt' | 'bejelentett' | 'oldott';

/** Egy feltöltendő minta (`jam_samples` sor; user_id-t a szerver adja). A pont a mért szakasz VÉGE, irányban. */
export interface JamSampleInsert {
  kind: JamKind;
  lat: number;
  lon: number;
  heading_deg: number | null;
  avg_kmh: number;
  length_m: number;
}

/** Egy friss közösségi minta (`active_jams`). */
export interface CommunityJam {
  id: string;
  lat: number;
  lon: number;
  headingDeg: number | null;
  avgKmh: number;
  lengthM: number;
  createdAt: number;
  own: boolean;
}

const heading = (h: number | null) => (h === null || !Number.isFinite(h) ? null : ((Math.round(h) % 360) + 360) % 360);

/** A minta a jelenlegi fixből: átlag (m/s → km/h, egészre), a mért szakasz hossza. */
export function jamSample(kind: JamKind, fix: Pick<GpsFix, 'lat' | 'lon' | 'heading'>, avgMps: number, lengthM: number): JamSampleInsert {
  return {
    kind,
    lat: fix.lat,
    lon: fix.lon,
    heading_deg: heading(fix.heading),
    avg_kmh: Math.max(0, Math.round(avgMps * 3.6)),
    length_m: Math.max(1, Math.round(lengthM)),
  };
}

/**
 * Más felhasználók friss (`communityMaxAgeMs`-nál fiatalabb), azonos irányú (±`communityHeadingDeg`) mintái az útvonal
 * `ROUTE_MATCH_M` sávjában: az érintett szakasz (`lengthM` a minta pontja előtt) ideje a mért átlaggal (legalább
 * `jamMinKmh`). Átfedésnél az újabb minta nyer. A saját és az irány nélküli minta nem számít.
 */
export function applyCommunityJams(route: NavRoute, durations: readonly number[], jams: readonly CommunityJam[], now: number): number[] {
  const out = [...durations];
  const fresh = jams.filter((j) => !j.own && j.headingDeg !== null && now - j.createdAt < TRAFFIC.communityMaxAgeMs).sort((a, b) => a.createdAt - b.createdAt);
  if (fresh.length === 0) return out;
  const core = new Route(route.points, route.distanceM);
  for (const j of fresh) {
    const p = core.project(j);
    if (p.crossM > ROUTE_MATCH_M || angleDiffDeg(j.headingDeg!, p.bearingDeg) > TRAFFIC.communityHeadingDeg) continue;
    const to = Math.min(route.distanceM, p.alongM);
    const from = Math.max(0, to - j.lengthM);
    const mps = Math.max(TRAFFIC.jamMinKmh, j.avgKmh) / 3.6;
    for (let i = 0; i < out.length; i++) {
      const a = route.segStartM[i]!;
      const b = i + 1 < route.segStartM.length ? route.segStartM[i + 1]! : route.distanceM;
      const overlap = Math.min(b, to) - Math.max(a, from);
      if (overlap <= 0 || b <= a) continue;
      out[i] = out[i]! - (out[i]! * overlap) / (b - a) + overlap / mps;
    }
  }
  return out;
}

/** A közösségi minták lekérésének téglalapja: az útvonal előttünk lévő `aheadM` része, `padM`-rel (fok). */
export function jamQueryBBox(route: NavRoute, alongM: number, aheadM = 30_000, padM = 500): { south: number; west: number; north: number; east: number } {
  const core = new Route(route.points, route.distanceM);
  const pts: LatLon[] = [];
  const end = Math.min(route.distanceM, alongM + aheadM);
  for (let d = Math.max(0, alongM - 1000); d < end; d += 500) pts.push(core.pointAt(d));
  pts.push(core.pointAt(end));
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const p of pts) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
  }
  const dLat = padM / 111_195;
  const dLon = padM / (111_195 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return { south: s - dLat, west: w - dLon, north: n + dLat, east: e + dLon };
}

/** Az alsó sáv borostyán felirata: „+N perc dugó”. */
export const trafficDelayLabel = (min: number): string => t('nav.delay', { n: min });
