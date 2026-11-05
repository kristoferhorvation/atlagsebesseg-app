import { angleDiffDeg, Route, type GpsFix, type LatLon } from '@atlagsebesseg/core';
import { t } from '../i18n';
import { ROUTE_MATCH_M } from './config';
import { DirectionsError, segmentAt } from './directions';
import type { NavRoute, NavStep } from './types';

/**
 * AW18: forgalom navigáció közben, helyi dugó-érzékelés, közösségi dugó-adat, újratervezés-újrapróbálás.
 * - `refreshMs`: friss driving-traffic lekérés ennyi időnként (a 2 perces alternatíva-figyeléssel közös hívás).
 * - `delayShowS`: a „+N perc dugó” ennyi késéstől (a friss ETA az indulási tervhez képest); a hang csak az első
 *   alkalommal szól, a további növekedésnél a sáv némán frissül.
 * - Dugó-állapot (AW23): a `jamWindowMs` (3 perc) ablak mért átlaga a MEGENGEDETT sebesség `jamSlowFraction`-ja (40%) alatt
 *   (50-esen < 1 km, 90-esen < 1,8 km, 130-ason < 2,6 km a 3 perc alatt). Nem autópálya-jellegű úton a lámpánál /
 *   kereszteződésnél / kanyarnál (`lightNearM`) állás az első `lightPatienceMs`-ig (2 perc) nem számít bele. Vége: a megengedett
 *   sebesség `jamClearFraction`-ja (70%) fölött legalább a `jamClearCity*` / `jamClearHighway*` távon és ideig.
 * - A „Dugóba kerültél?” kártya `jamPromptMs` után válasz nélkül eltűnik.
 * - A dugós ETA a mért átlagot (legalább `jamMinKmh`) csak az előttünk lévő, a Directions congestion-annotációjában
 *   heavy / severe összefüggő szakaszra használja, legfeljebb `jamAheadMaxM`-ig; congestion-adat nélkül legfeljebb
 *   `jamNoDataMaxM`-ig, a tempó lineárisan megy át a tervezettbe. A dugó-állapot végén azonnal a tervezett idők.
 * - Dugó közben `jamUploadMs`-enként új közösségi minta; a közösségi adat `communityMaxAgeMs`-ig él, a bejelentett minta
 *   hossza `reportedLengthM`.
 * - Újratervezés-hiba után a következő próba `rerouteBackoffS` szerint (a végén maradó érték ismétlődik); a lekérés
 *   `directionsTimeoutMs` után időtúllépés.
 */
export const TRAFFIC = {
  refreshMs: 120_000,
  delayShowS: 180,
  /** A dugó-többlet legfeljebb a hátralévő menetidő ekkora része (4 perces úton 2 perc). */
  delayMaxFraction: 0.5,
  jamWindowMs: 180_000,
  jamSlowFraction: 0.4,
  /** Az ablak eleje előtt legalább ennyit már haladtunk: a parkolóban várakozás nem dugó (m). */
  jamStartMovedM: 100,
  /** Ez alatt áll a kocsi (m/s, 5 km/h). */
  jamStoppedMps: 1.4,
  /** A jelzőlámpa / kereszteződés / kanyar ennyin belül: a megállás lámpa-idő (m). */
  lightNearM: 60,
  /** A lámpa-türelem egy ponton (ms); ennyi nem számít bele a dugó-ablakba. */
  lightPatienceMs: 120_000,
  jamClearFraction: 0.7,
  jamClearCityM: 1000,
  jamClearCityMs: 120_000,
  jamClearHighwayM: 3000,
  jamClearHighwayMs: 180_000,
  /** „Nem” válasz után ennyi ideig nincs újabb kérdés (ms). */
  jamDeclineMuteMs: 600_000,
  jamPromptMs: 15_000,
  jamAheadMaxM: 2000,
  jamNoDataMaxM: 1000,
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

/** AW23: a kártyák sorrendje: a leggyorsabb legfelül, a többi menetidő szerint (egyenlőnél az eredeti sorrend). */
export function routeOrder(durationsS: readonly number[]): number[] {
  return durationsS.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.i);
}

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

/** A dugó-érzékelés bemenete a jelenlegi helyről. */
export interface JamContext {
  /** A megengedett sebesség (m/s): {@link permittedKmhAt}. */
  limitMps: number;
  /** Autópálya vagy autóút: nincs lámpa-türelem, nagyobb a kilépési táv. */
  highway: boolean;
  /** Jelzőlámpa, kereszteződés vagy kanyar `lightNearM`-en belül. */
  nearStopPoint: boolean;
  /** A hátralévő úton van heavy / severe szakasz: a helyi ETA-korrekció addig nem jár le. */
  heavyAhead: boolean;
}

/**
 * Dugó-állapot a mért haladásból (AW23). A megtett utat az útvonal menti legtávolabbi elért pont növekedése adja (álló
 * helyzetben az oda-vissza GPS-zaj nem „halad”); útvonal-csere után `rebase()`. Az ablak „érvényes” időben mér: a lámpa-türelem
 * alatti állás nem számít bele. Belépés: `jamWindowMs` érvényes idő átlaga a megengedett sebesség `jamSlowFraction`-ja alatt, és
 * az ablak előtt már haladtunk. Kilépés: az útkategória szerinti ablakban a megengedett sebesség `jamClearFraction`-ja fölött.
 */
export class JamDetector {
  private odo = 0;
  /** Az útvonal mentén eddig elért legtávolabbi pont: csak ennek növekedése haladás (a zaj oda-vissza nem). */
  private maxAlong: number | null = null;
  /** Érvényes idő (ms): a lámpa-türelem nélkül. */
  private eff = 0;
  private lastT: number | null = null;
  private hist: { eff: number; odo: number }[] = [];
  private hold: { odo: number; ms: number } | null = null;
  private jam = false;
  /** A tempó helyreállt, de a hátralévő úton még van heavy / severe: az ETA-korrekció marad. */
  private etaHold = false;
  private lastClear: { avgMps: number; m: number } | null = null;

  /** Új fix: `t` (ms), útvonal menti hely (m), pillanatnyi sebesség (m/s; `null`: a haladásból). */
  update(t: number, alongM: number, speedMps: number | null, ctx: JamContext): JamChange {
    const before = this.odo;
    if (this.maxAlong !== null) this.odo += Math.max(0, alongM - this.maxAlong);
    this.maxAlong = Math.max(this.maxAlong ?? alongM, alongM);
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    const speed = speedMps ?? (dt > 0 ? ((this.odo - before) * 1000) / dt : 0);
    this.lastT = t;
    // lámpa-türelem: csak nem autópálya-jellegű úton, pontonként legfeljebb `lightPatienceMs`
    let counted = true;
    if (!ctx.highway && ctx.nearStopPoint && speed <= TRAFFIC.jamStoppedMps) {
      if (!this.hold || this.odo - this.hold.odo > TRAFFIC.lightNearM) this.hold = { odo: this.odo, ms: 0 };
      this.hold.ms += dt;
      counted = this.hold.ms > TRAFFIC.lightPatienceMs;
    } else if (this.hold && this.odo - this.hold.odo > TRAFFIC.lightNearM) this.hold = null;
    if (counted) this.eff += dt;
    this.hist.push({ eff: this.eff, odo: this.odo });
    const keep = Math.max(TRAFFIC.jamWindowMs, TRAFFIC.jamClearHighwayMs);
    while (this.hist.length > 2 && this.hist[1]!.eff <= this.eff - keep) this.hist.shift();
    if (!this.jam) {
      if (this.etaHold && !ctx.heavyAhead) this.etaHold = false;
      const w = this.windowOf(TRAFFIC.jamWindowMs);
      if (w && w.startOdo >= TRAFFIC.jamStartMovedM && w.avgMps < TRAFFIC.jamSlowFraction * ctx.limitMps) {
        this.jam = true;
        this.etaHold = false;
        return 'enter';
      }
      return null;
    }
    const w = this.windowOf(ctx.highway ? TRAFFIC.jamClearHighwayMs : TRAFFIC.jamClearCityMs);
    if (w && w.m >= (ctx.highway ? TRAFFIC.jamClearHighwayM : TRAFFIC.jamClearCityM) && w.avgMps >= TRAFFIC.jamClearFraction * ctx.limitMps) {
      this.lastClear = { avgMps: w.avgMps, m: w.m };
      this.jam = false;
      this.etaHold = ctx.heavyAhead;
      // a dugós ablak ne indítson azonnal újra
      this.hist = [{ eff: this.eff, odo: this.odo }];
      return 'exit';
    }
    return null;
  }

  /** A legutóbbi `ms` érvényes idő átlaga és hossza; `null`, ha még nincs ennyi adat. */
  private windowOf(ms: number): { avgMps: number; m: number; startOdo: number } | null {
    const b = this.hist.at(-1);
    if (!b) return null;
    let a: { eff: number; odo: number } | null = null;
    for (const h of this.hist) {
      if (h.eff > b.eff - ms) break;
      a = h;
    }
    if (!a || b.eff <= a.eff) return null;
    const m = b.odo - a.odo;
    return { avgMps: (m * 1000) / (b.eff - a.eff), m, startOdo: a.odo };
  }

  /** Új útvonal: a hely mostantól az új útvonalon mérődik (a megtett út megmarad). */
  rebase(): void {
    this.maxAlong = null;
  }

  /** „Nem” válasz: a sofőr szerint nincs dugó, az állapot és az ablak törlődik. */
  dismiss(): void {
    this.jam = false;
    this.etaHold = false;
    const last = this.hist.at(-1);
    this.hist = last ? [last] : [];
  }

  get active(): boolean {
    return this.jam;
  }

  /** A helyi ETA-korrekció él: dugóban, vagy amíg a hátralévő úton heavy / severe szakasz van. */
  get correcting(): boolean {
    return this.jam || this.etaHold;
  }

  /** Az utolsó ablak átlaga (m/s); egy mintánál `null`. */
  get avgMps(): number | null {
    const a = this.hist[0];
    const b = this.hist.at(-1);
    if (!a || !b || b.eff <= a.eff) return null;
    return ((b.odo - a.odo) * 1000) / (b.eff - a.eff);
  }

  /** A dugó végét jelző szakasz átlaga (m/s) – a „feloldva” közösségi mintához. */
  get clearedAvgMps(): number | null {
    return this.lastClear?.avgMps ?? null;
  }

  /** A dugó végét jelző szakasz hossza (m). */
  get clearedM(): number {
    return this.lastClear?.m ?? TRAFFIC.jamClearCityM;
  }

  /** A megtett út (m) – a minta hosszához. */
  get odometerM(): number {
    return this.odo;
  }
}

// ---------------------------------------------------------------------------
// A megengedett sebesség, útkategória, lámpák
// ---------------------------------------------------------------------------

/** Az útkategória országos alapértelmezése (km/h), ha a szakaszon nincs táblaadat (magyar értékek: a célpiac). */
export const DEFAULT_LIMIT_KMH = { motorway: 130, trunk: 110, rural: 90, city: 50 } as const;

const HIGHWAY_CLASSES = ['motorway', 'motorway_link', 'trunk', 'trunk_link'];
const RURAL_CLASSES = ['primary', 'primary_link', 'secondary', 'secondary_link'];

/** A lépés a hely alatt. */
export function stepAt(route: NavRoute, alongM: number): NavStep | undefined {
  let found = route.steps[0];
  for (const s of route.steps) {
    if (s.startM > alongM) break;
    found = s;
  }
  return found;
}

/** A nyers Directions-tempó (km/h) a szakaszon: útkategória nélkül ebből becsülünk. */
const rawKmhAt = (route: NavRoute, i: number): number => {
  const b = i + 1 < route.segStartM.length ? route.segStartM[i + 1]! : route.distanceM;
  const d = route.segDurationS[i] ?? 0;
  return d > 0 ? ((b - route.segStartM[i]!) / d) * 3.6 : 0;
};

/** A megengedett sebesség (km/h) a helyen: a tábla (maxspeed), ennek hiányában az útkategória alapértelmezése. */
export function permittedKmhAt(route: NavRoute, alongM: number): number {
  const i = segmentAt(route, alongM);
  const sign = route.segLimitKmh[i];
  if (sign !== null && sign !== undefined) return sign;
  const cls = stepAt(route, alongM)?.roadClass ?? null;
  if (cls === 'motorway' || cls === 'motorway_link') return DEFAULT_LIMIT_KMH.motorway;
  if (cls === 'trunk' || cls === 'trunk_link') return DEFAULT_LIMIT_KMH.trunk;
  if (cls !== null) return RURAL_CLASSES.includes(cls) ? DEFAULT_LIMIT_KMH.rural : DEFAULT_LIMIT_KMH.city;
  const raw = rawKmhAt(route, i);
  return raw >= 90 ? DEFAULT_LIMIT_KMH.motorway : raw >= 60 ? DEFAULT_LIMIT_KMH.rural : DEFAULT_LIMIT_KMH.city;
}

/** Autópálya-jellegű-e az út a helyen (autópálya, autóút; kategória nélkül a 100 km/h feletti tábla). */
export function highwayAt(route: NavRoute, alongM: number): boolean {
  const cls = stepAt(route, alongM)?.roadClass ?? null;
  return cls !== null ? HIGHWAY_CLASSES.includes(cls) : permittedKmhAt(route, alongM) >= 100;
}

/** Jelzőlámpa, kereszteződés vagy kanyar `lightNearM`-en belül (a Directions-lépések kereszteződései és manőverei). */
export function nearStopPoint(route: NavRoute, alongM: number): boolean {
  return route.stopPointsM.some((m) => Math.abs(m - alongM) <= TRAFFIC.lightNearM);
}

/** A hátralévő úton van-e heavy / severe szakasz. */
export function heavyAhead(route: NavRoute, alongM: number): boolean {
  for (let i = segmentAt(route, alongM); i < route.segCongestion.length; i++) {
    const c = route.segCongestion[i];
    if (c === 'heavy' || c === 'severe') return true;
  }
  return false;
}

/**
 * A dugó-többlet (s) a hátralévő úton – EGY számítás az útvonalválasztónak és a navigációnak (AW23). Heavy / severe szakasz
 * nélkül 0 (nincs felirat térképi szakasz nélkül). Különben a hátralévő idő a tipikus fölött (a lépések `duration_typical`-ja;
 * ha nincs, a dugós idő fele), legfeljebb a dugós szakaszok ideje és a hátralévő idő `delayMaxFraction`-ja.
 */
export function routeDelayS(route: NavRoute, alongM = 0): number {
  const n = route.segDurationS.length;
  const first = Math.min(n - 1, segmentAt(route, alongM));
  let remS = 0;
  let heavyS = 0;
  for (let i = first; i < n; i++) {
    const a = route.segStartM[i]!;
    const b = i + 1 < route.segStartM.length ? route.segStartM[i + 1]! : route.distanceM;
    const part = i === first && b > a ? Math.max(0, Math.min(1, (b - alongM) / (b - a))) : 1;
    const d = (route.segDurationS[i] ?? 0) * part;
    remS += d;
    const c = route.segCongestion[i];
    if (c === 'heavy' || c === 'severe') heavyS += d;
  }
  if (heavyS <= 0) return 0;
  let typicalS: number | null = 0;
  for (const s of route.steps) {
    const end = s.startM + s.distanceM;
    if (end <= alongM) continue;
    if (s.durationTypicalS === null) {
      typicalS = null;
      break;
    }
    typicalS += s.durationTypicalS * (s.startM >= alongM || s.distanceM <= 0 ? 1 : (end - alongM) / s.distanceM);
  }
  if (typicalS === null && route.typicalDurationS !== null) typicalS = (route.typicalDurationS * Math.max(0, route.distanceM - alongM)) / (route.distanceM || 1);
  const excess = typicalS === null ? heavyS / 2 : Math.max(0, remS - typicalS);
  return Math.round(Math.min(excess, heavyS, TRAFFIC.delayMaxFraction * remS));
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

// ---------------------------------------------------------------------------
// AW19-javítás 2: a dugós ETA horizontja
// ---------------------------------------------------------------------------

/** A mért dugó-átlag érvényességi szakasza az útvonalon (m); `linear`: nincs congestion-adat, a tempó átmegy a tervezettbe. */
export interface JamRun {
  startM: number;
  endM: number;
  linear: boolean;
}

/**
 * Az előttünk lévő dugós szakasz: a Directions congestion-annotációjában az első heavy / severe összefüggő szakasz, a
 * pozíciónktól legfeljebb `jamAheadMaxM`-ig. Congestion-adat nélkül (minden szakasz `unknown`) a következő `jamNoDataMaxM`.
 * `null`: az annotáció szerint nincs dugó előttünk.
 */
export function jamAheadRun(route: NavRoute, alongM: number): JamRun | null {
  const n = route.segCongestion.length;
  const end = (i: number) => (i + 1 < route.segStartM.length ? route.segStartM[i + 1]! : route.distanceM);
  if (!route.segCongestion.some((c) => c !== 'unknown')) {
    const endM = Math.min(route.distanceM, alongM + TRAFFIC.jamNoDataMaxM);
    return endM > alongM ? { startM: alongM, endM, linear: true } : null;
  }
  const heavy = (i: number) => route.segCongestion[i] === 'heavy' || route.segCongestion[i] === 'severe';
  const limit = Math.min(route.distanceM, alongM + TRAFFIC.jamAheadMaxM);
  let i = segmentAt(route, alongM);
  while (i < n && !heavy(i) && end(i) < limit) i++;
  if (i >= n || !heavy(i)) return null;
  const startM = Math.max(alongM, route.segStartM[i]!);
  let j = i;
  while (j + 1 < n && heavy(j + 1)) j++;
  const endM = Math.min(end(j), limit);
  return endM > startM ? { startM, endM, linear: false } : null;
}

/**
 * A mért tempó (`avgMps`) miatti többletidő (s) a `run` szakaszon, a tervezett idő (`plannedS`) fölött: dugós szakaszon végig a
 * mért átlag; `linear` esetben a tempó a mértről lineárisan a tervezettre vált (a tempó-reciprok átlaga).
 */
export function jamExtraS(run: JamRun, avgMps: number, plannedS: number): number {
  const d = run.endM - run.startM;
  const v = Math.max(avgMps, TRAFFIC.jamMinKmh / 3.6);
  const slow = d / v;
  return Math.max(0, run.linear ? (slow - plannedS) / 2 : slow - plannedS);
}
