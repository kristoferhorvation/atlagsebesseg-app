import { haversineM, LocalProjection, type GpsFix, type LatLon } from '@atlagsebesseg/core';
import { formatDistance, speedIn, unitLabel } from './display';
import type { SpeedUnit } from './settings';
import { t } from './i18n';
import { formatTripDuration } from './navigation/maneuver';

/**
 * AW19: krúzing mód és az utak naplója (platformfüggetlen; a Swift-pár: `Logic/Trips.swift`, azonos nevű tesztekkel).
 * Cél nélkül is: ha a kocsi mozog (≥ `startKmh` legalább `startHoldS`-ig), egy „út” felvétele indul; `stopIdleS` állás
 * vagy a GPS leállása zárja. A navigáció és a szakaszmérés ugyanabba az útba kerül (cél neve, újratervezések, mérések).
 * Minden adat helyben marad (web: IndexedDB, iOS: SQLite) – szerverre semmi.
 */
export const TRIP = {
  /** Az út indulása: legalább ekkora sebesség (km/h)… */
  startKmh: 10,
  /** …ennyi ideig megszakítás nélkül (s); az út kezdete e szakasz eleje. */
  startHoldS: 30,
  /** Ez alatt (km/h) áll a kocsi: állásidő, nincs távolság. */
  idleKmh: 5,
  /** Ennyi folyamatos állás (s) zárja az utat; a vége az utolsó mozgó minta (a záró állás nem része). */
  stopIdleS: 300,
  /** Ennél rosszabb pontosságú (m) minta nem ad távolságot / max sebességet. */
  maxAccuracyM: 50,
  /** Két minta közti ennél nagyobb látszólagos sebesség (km/h) ugrás: nincs távolság, az útvonal új darabot kezd. */
  maxJumpKmh: 250,
  /** Kanyar: legalább ekkora irányváltás (°)… */
  turnDeg: 60,
  /** …ennyi idő alatt (s). */
  turnWindowS: 5,
  /** A kanyar vége: az utolsó `turnSettleS` alatt `turnSettleDeg`-nél kisebb irányváltás. */
  turnSettleS: 3,
  turnSettleDeg: 15,
  /** A kanyar eleje és vége közti nettó irányváltás ennél kisebb (°): nem kanyar (S-kanyar, körforgalom egyenesen). */
  turnMinNetDeg: 45,
  /** Ennél nagyobb nettó irányváltás (°) megfordulás. */
  uTurnDeg: 150,
  /** Az irány csak ennél gyorsabb haladásnál (km/h) megbízható. */
  turnMinKmh: 10,
  /** Egy kanyar legfeljebb ennyi ideig tart (s); utána lezárjuk. */
  turnMaxS: 60,
  /** Az útvonal egyszerűsítése (Douglas–Peucker tűrése, m). */
  simplifyM: 10,
  /** A H3-cella felbontása a mintákban (a hőtérképhez; ~66 m-es cellák). */
  h3Res: 10,
  /** Ennél sűrűbb fixek közül csak egy kerül a mintába (ms) – 1 Hz. */
  sampleMinMs: 900,
  /** Ennél rövidebb út (m) nem kerül a naplóba. */
  minTripM: 200,
} as const;

/** Egy GPS-minta a helyi tárolóban (1 Hz). A `h3` a tároló tölti ki (web: h3-js, iOS: SwiftyH3); `null`, ha nem sikerült. */
export interface TripSample {
  tripId: string;
  t: number;
  lat: number;
  lon: number;
  speedKmh: number | null;
  heading: number | null;
  accuracy: number | null;
  h3: string | null;
}

/** Egy szakaszmérés az úton (a mérés eredményéből). */
export interface TripMeasurement {
  sectionId: string;
  /** „M1 · Budapest → Győr”. */
  name: string;
  avgKmh: number;
  limitKmh: number;
  tooFast: boolean;
  /** A mérés vége (ms). */
  at: number;
}

export interface TripTurns {
  left: number;
  right: number;
  uTurn: number;
}

/** Egy út rekordja a naplóban. */
export interface Trip {
  id: string;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  /** Menetidő (s): a mozgó minták ideje. */
  movingS: number;
  /** Állásidő (s): az út közbeni állás (a záró állás nem része). */
  idleS: number;
  maxKmh: number;
  turns: TripTurns;
  reroutes: number;
  measurements: TripMeasurement[];
  /** Dugóban töltött idő (s; az AW18 helyi dugó-állapotából). */
  jamS: number;
  /** A navigáció célja (az utolsó), ha volt. */
  destination: string | null;
  /** Az útvonal egyszerűsítve (Douglas–Peucker, `simplifyM`), darabokban ([lat, lon], 6 tizedes); ugrásnál új darab. */
  path: [number, number][][];
  /** A mintaszám (a tárolt GPS-minták). */
  samples: number;
}

/** A futó út az üres nézet állapotsorához. */
export interface CruiseView {
  tripId: string;
  startedAt: number;
  distanceM: number;
  elapsedS: number;
}

export type TripEnd = { kind: 'saved'; trip: Trip } | { kind: 'discarded'; id: string };

/** Előjeles irányváltás `from` → `to` (°, −180…180; pozitív = jobbra). */
export function headingDelta(to: number, from: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Átlagsebesség a menetidőre (km/h); menetidő nélkül `null`. */
export const tripAvgKmh = (trip: Pick<Trip, 'distanceM' | 'movingS'>): number | null => (trip.movingS > 0 ? (trip.distanceM / trip.movingS) * 3.6 : null);

// ---------------------------------------------------------------------------
// kanyarok
// ---------------------------------------------------------------------------

/**
 * Kanyar-felismerés az irányból: `turnWindowS` alatt legalább `turnDeg` irányváltás indít egy kanyart; vége, ha az irány
 * `turnSettleS` óta `turnSettleDeg`-en belül marad (vagy `turnMaxS` letelt, vagy 10 s-ig nincs irány). A nettó irányváltás
 * dönt: `uTurnDeg` fölött megfordulás, `turnMinNetDeg` alatt semmi (S-kanyar), különben jobbra / balra.
 */
export class TurnDetector {
  readonly turns: TripTurns = { left: 0, right: 0, uTurn: 0 };
  private hist: { t: number; h: number }[] = [];
  private turn: { startH: number; startT: number } | null = null;
  private last: { t: number; h: number } | null = null;

  /** Egy minta: az irány (°) vagy `null` (lassú haladás / nincs adat). */
  feed(t: number, heading: number | null): void {
    if (heading === null) {
      if (this.turn && this.last && t - this.last.t > 10_000) this.end(this.last);
      return;
    }
    const cur = { t, h: heading };
    this.hist.push(cur);
    while (this.hist.length > 1 && this.hist[0]!.t < t - TRIP.turnWindowS * 1000) this.hist.shift();
    this.last = cur;
    if (!this.turn) {
      const ref = this.hist[0]!;
      if (Math.abs(headingDelta(heading, ref.h)) >= TRIP.turnDeg) this.turn = { startH: ref.h, startT: ref.t };
      return;
    }
    const settle = this.hist.find((x) => x.t >= t - TRIP.turnSettleS * 1000)!;
    const settled = t - settle.t >= (TRIP.turnSettleS - 1) * 1000 && Math.abs(headingDelta(heading, settle.h)) < TRIP.turnSettleDeg;
    if (settled || t - this.turn.startT > TRIP.turnMaxS * 1000) this.end(cur);
  }

  /** Az út vége: a még nyitott kanyar lezárása. */
  finish(): void {
    if (this.turn && this.last) this.end(this.last);
  }

  /** Ugrás (a pozíció folytonossága megszakadt): a nyitott kanyar és az irány-előzmény elvész, nem számít. */
  reset(): void {
    this.turn = null;
    this.hist = [];
    this.last = null;
  }

  private end(at: { t: number; h: number }): void {
    const net = headingDelta(at.h, this.turn!.startH);
    if (Math.abs(net) >= TRIP.uTurnDeg) this.turns.uTurn++;
    else if (net >= TRIP.turnMinNetDeg) this.turns.right++;
    else if (net <= -TRIP.turnMinNetDeg) this.turns.left++;
    this.turn = null;
    this.hist = [at];
  }
}

// ---------------------------------------------------------------------------
// útvonal-egyszerűsítés
// ---------------------------------------------------------------------------

/** Douglas–Peucker (helyi síkvetületben, `tolM` méter tűréssel); a két végpont mindig megmarad. */
export function simplifyPath(points: readonly LatLon[], tolM: number = TRIP.simplifyM): LatLon[] {
  if (points.length <= 2) return [...points];
  const proj = new LocalProjection(points[0]!);
  const xy = points.map((p) => proj.toXY(p));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const pa = xy[a]!;
    const pb = xy[b]!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = 0;
    for (let i = a + 1; i < b; i++) {
      const p = xy[i]!;
      let d: number;
      if (len2 === 0) d = Math.hypot(p.x - pa.x, p.y - pa.y);
      else {
        const k = Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / len2));
        d = Math.hypot(p.x - (pa.x + k * dx), p.y - (pa.y + k * dy));
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD > tolM) {
      keep[best] = true;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// a felvevő
// ---------------------------------------------------------------------------

interface Running {
  id: string;
  startedAt: number;
  lastT: number;
  lastMovingT: number;
  /** Az utolsó pontos minta (a távolság innen számol). */
  prev: { lat: number; lon: number; t: number } | null;
  distanceM: number;
  movingS: number;
  idleS: number;
  /** Az út közbeni állás, ami még a záró állás is lehet: mozgáskor a menetbe / állásba kerül. */
  idlePendingS: number;
  idleBuf: TripSample[];
  maxKmh: number;
  turns: TurnDetector;
  reroutes: number;
  measurements: TripMeasurement[];
  jamOnAt: number | null;
  jamS: number;
  destination: string | null;
  segments: LatLon[][];
  samples: number;
}

export interface TripRecorderOptions {
  /** Új út azonosítója (alapból idő + véletlen). */
  newId?: (startedAt: number) => string;
}

const defaultId = (startedAt: number) => `trip-${startedAt.toString(36)}-${Math.floor(Math.random() * 36 ** 6).toString(36)}`;

/**
 * Az utak felvétele a GPS-fixekből: indulás (`startKmh` × `startHoldS`), minták (1 Hz), táv / menet- / állásidő, max
 * sebesség, kanyarok, majd zárás (`stopIdleS` állás, vagy `stop()` a GPS leállásakor). A navigáció és a mérés eseményei
 * (`noteReroute`, `noteJam`, `noteMeasurement`, `setDestination`) a futó útba kerülnek. A tárolás az appé: a
 * `drainSamples()` az új mintákat, a `drainEnded()` a lezárt (vagy túl rövid, eldobott) utakat adja.
 */
export class TripRecorder {
  private readonly newId: (startedAt: number) => string;
  private run: Running | null = null;
  /** Indulás előtt: a `startKmh` fölötti minták sora (az út eleje). */
  private pending: { fix: GpsFix; kmh: number }[] = [];
  private lastFix: GpsFix | null = null;
  private lastAcceptedT = -Infinity;
  private outbox: TripSample[] = [];
  private ended: TripEnd[] = [];
  private destination: string | null = null;

  constructor(opts: TripRecorderOptions = {}) {
    this.newId = opts.newId ?? defaultId;
  }

  /** Egy GPS-fix (a mérés és a navigáció ugyanazokat kapja). */
  onFix(input: GpsFix): void {
    // egész ms (a CLLocation-időbélyeg oda-vissza alakítása ne mozdítsa el a küszöböket)
    const fix = Number.isInteger(input.timestamp) ? input : { ...input, timestamp: Math.round(input.timestamp) };
    if (fix.timestamp - this.lastAcceptedT < TRIP.sampleMinMs) return;
    const kmh = this.speedKmhOf(fix);
    this.lastAcceptedT = fix.timestamp;
    this.lastFix = fix;
    if (this.run && fix.timestamp - this.run.lastT > TRIP.stopIdleS * 1000) this.finish();
    if (this.run) {
      this.add(this.run, fix, kmh);
      return;
    }
    if (kmh !== null && kmh >= TRIP.startKmh && accurate(fix)) {
      this.pending.push({ fix, kmh });
      if (fix.timestamp - this.pending[0]!.fix.timestamp >= TRIP.startHoldS * 1000) this.begin();
    } else this.pending = [];
  }

  /** Óra-lépés fix nélkül is: a hosszú csend (nincs fix `stopIdleS`-ig) zárja az utat. */
  tick(now: number): void {
    if (this.run && now - this.run.lastMovingT >= TRIP.stopIdleS * 1000) this.finish();
  }

  /** A GPS leállt (az app leállította / háttérbe ment): a futó út lezárul. */
  stop(): void {
    this.pending = [];
    if (this.run) this.finish();
  }

  /** Újratervezés a navigációban (a futó útba). */
  noteReroute(): void {
    if (this.run) this.run.reroutes++;
  }

  /** A navigáció helyi dugó-állapota (AW18) – a dugóban töltött idő. */
  noteJam(on: boolean, t: number): void {
    const r = this.run;
    if (!r) return;
    if (on && r.jamOnAt === null) r.jamOnAt = t;
    if (!on && r.jamOnAt !== null) {
      r.jamS += Math.max(0, t - r.jamOnAt) / 1000;
      r.jamOnAt = null;
    }
  }

  /** Egy befejezett szakaszmérés. */
  noteMeasurement(m: TripMeasurement): void {
    this.run?.measurements.push(m);
  }

  /** A navigáció célja (`null`: nincs navigáció); a futó útra és a következőre is. */
  setDestination(name: string | null): void {
    this.destination = name;
    if (this.run && name) this.run.destination = name;
  }

  /** A futó út (az állapotsorhoz); `null`, ha nincs. */
  view(now: number): CruiseView | null {
    const r = this.run;
    return r ? { tripId: r.id, startedAt: r.startedAt, distanceM: r.distanceM, elapsedS: Math.max(0, now - r.startedAt) / 1000 } : null;
  }

  /** Az új minták (a tárolónak). */
  drainSamples(): TripSample[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /** A lezárt utak (mentendő) és az eldobott rövidek (a mintáik törlendők). */
  drainEnded(): TripEnd[] {
    const out = this.ended;
    this.ended = [];
    return out;
  }

  private speedKmhOf(fix: GpsFix): number | null {
    if (fix.speed !== null && fix.speed >= 0) return fix.speed * 3.6;
    const p = this.lastFix;
    if (!p || fix.timestamp <= p.timestamp) return null;
    return (haversineM(p, fix) / ((fix.timestamp - p.timestamp) / 1000)) * 3.6;
  }

  private begin(): void {
    const first = this.pending[0]!.fix;
    const r: Running = {
      id: this.newId(first.timestamp),
      startedAt: first.timestamp,
      lastT: first.timestamp,
      lastMovingT: first.timestamp,
      prev: null,
      distanceM: 0,
      movingS: 0,
      idleS: 0,
      idlePendingS: 0,
      idleBuf: [],
      maxKmh: 0,
      turns: new TurnDetector(),
      reroutes: 0,
      measurements: [],
      jamOnAt: null,
      jamS: 0,
      destination: this.destination,
      segments: [[]],
      samples: 0,
    };
    this.run = r;
    const pending = this.pending;
    this.pending = [];
    for (const p of pending) this.add(r, p.fix, p.kmh);
  }

  private add(r: Running, fix: GpsFix, kmh: number | null): void {
    const t = fix.timestamp;
    const dt = Math.max(0, t - r.lastT) / 1000;
    r.lastT = t;
    const moving = kmh !== null && kmh >= TRIP.idleKmh;
    const good = accurate(fix);
    const sample: TripSample = {
      tripId: r.id,
      t,
      lat: fix.lat,
      lon: fix.lon,
      speedKmh: kmh === null ? null : Math.round(kmh * 10) / 10,
      heading: fix.heading,
      accuracy: fix.accuracy,
      h3: null,
    };
    if (good && r.prev && t > r.prev.t && (haversineM(r.prev, fix) / ((t - r.prev.t) / 1000)) * 3.6 > TRIP.maxJumpKmh) r.turns.reset();
    r.turns.feed(t, kmh !== null && kmh >= TRIP.turnMinKmh && fix.heading !== null ? fix.heading : null);
    if (!moving) {
      r.idlePendingS += dt;
      r.idleBuf.push(sample);
      if (good) r.prev = { lat: fix.lat, lon: fix.lon, t };
      if (t - r.lastMovingT >= TRIP.stopIdleS * 1000) this.finish();
      return;
    }
    // mozgás: az addigi állás az út része volt
    r.idleS += r.idlePendingS;
    r.idlePendingS = 0;
    r.movingS += dt;
    r.lastMovingT = t;
    for (const s of r.idleBuf) this.emit(r, s);
    r.idleBuf = [];
    this.emit(r, sample);
    if (!good) return;
    const seg = r.segments.at(-1)!;
    if (r.prev) {
      const d = haversineM(r.prev, fix);
      const dts = (t - r.prev.t) / 1000;
      if (dts > 0 && (d / dts) * 3.6 <= TRIP.maxJumpKmh) r.distanceM += d;
      else if (seg.length > 0) r.segments.push([]);
    }
    r.segments.at(-1)!.push({ lat: fix.lat, lon: fix.lon });
    r.prev = { lat: fix.lat, lon: fix.lon, t };
    r.maxKmh = Math.max(r.maxKmh, kmh);
  }

  private emit(r: Running, s: TripSample): void {
    r.samples++;
    this.outbox.push(s);
  }

  private finish(): void {
    const r = this.run!;
    this.run = null;
    this.pending = [];
    r.turns.finish();
    const endedAt = r.lastMovingT;
    if (r.jamOnAt !== null) r.jamS += Math.max(0, endedAt - r.jamOnAt) / 1000;
    if (r.distanceM < TRIP.minTripM) {
      this.ended.push({ kind: 'discarded', id: r.id });
      return;
    }
    const path = r.segments
      .filter((s) => s.length >= 2)
      .map((s) => simplifyPath(s).map((p): [number, number] => [round6(p.lat), round6(p.lon)]));
    this.ended.push({
      kind: 'saved',
      trip: {
        id: r.id,
        startedAt: r.startedAt,
        endedAt,
        distanceM: Math.round(r.distanceM),
        movingS: Math.round(r.movingS),
        idleS: Math.round(r.idleS),
        maxKmh: Math.round(r.maxKmh * 10) / 10,
        turns: { ...r.turns.turns },
        reroutes: r.reroutes,
        measurements: r.measurements,
        jamS: Math.round(r.jamS),
        destination: r.destination,
        path,
        samples: r.samples,
      },
    });
  }
}

const accurate = (fix: GpsFix) => fix.accuracy === null || fix.accuracy <= TRIP.maxAccuracyM;

// ---------------------------------------------------------------------------
// statisztika
// ---------------------------------------------------------------------------

/** Az összesítő kártya időszaka: ez a hét (hétfőtől), ez a hónap, összes. */
export type TripPeriod = 'het' | 'honap' | 'osszes';
export const TRIP_PERIODS: readonly TripPeriod[] = ['het', 'honap', 'osszes'];

/** Az időszak kezdete (ms, a készülék időzónájában): a hét hétfője 0:00, a hónap 1-je 0:00; `osszes`: `null`. */
export function periodStart(period: TripPeriod, now: number): number | null {
  if (period === 'osszes') return null;
  const d = new Date(now);
  if (period === 'honap') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

export interface TripTotals {
  trips: number;
  distanceM: number;
  movingS: number;
  avgKmh: number | null;
  turns: TripTurns;
  checksOk: number;
  checksTooFast: number;
  jamS: number;
}

/** Az időszak összesítése (az út a kezdete szerint számít). */
export function tripTotals(trips: readonly Trip[], period: TripPeriod, now: number): TripTotals {
  const from = periodStart(period, now);
  const sel = trips.filter((x) => from === null || x.startedAt >= from);
  const sum = (f: (x: Trip) => number) => sel.reduce((a, x) => a + f(x), 0);
  const distanceM = sum((x) => x.distanceM);
  const movingS = sum((x) => x.movingS);
  const checks = sel.flatMap((x) => x.measurements);
  return {
    trips: sel.length,
    distanceM,
    movingS,
    avgKmh: tripAvgKmh({ distanceM, movingS }),
    turns: { left: sum((x) => x.turns.left), right: sum((x) => x.turns.right), uTurn: sum((x) => x.turns.uTurn) },
    checksOk: checks.filter((m) => !m.tooFast).length,
    checksTooFast: checks.filter((m) => m.tooFast).length,
    jamS: sum((x) => x.jamS),
  };
}

/** Legújabb elöl (a napló listája). */
export const sortTrips = (trips: readonly Trip[]): Trip[] => [...trips].sort((a, b) => b.startedAt - a.startedAt);

// ---------------------------------------------------------------------------
// feliratok
// ---------------------------------------------------------------------------

const distText = (m: number, unit: SpeedUnit) => {
  const d = formatDistance(m, unit);
  return `${d.value} ${d.unit}`;
};

/** Az üres nézet állapotsora: „Krúzing · 12,4 km · 23 perc”. */
export function cruiseStatusText(v: Pick<CruiseView, 'distanceM' | 'elapsedS'>, unit: SpeedUnit): string {
  return t('trips.cruiseStatus', { dist: distText(v.distanceM, unit), time: formatTripDuration(v.elapsedS) });
}

/** Az út címe: a cél neve, vagy „Krúzing”. */
export const tripTitle = (trip: Pick<Trip, 'destination'>): string => trip.destination ?? t('trips.cruise');

/** Sebesség a választott egységben („87 km/h”); adat nélkül „–”. */
export function tripSpeedText(kmh: number | null, unit: SpeedUnit): string {
  const v = speedIn(kmh, unit);
  return v === null ? '–' : `${Math.round(v)} ${unitLabel(unit)}`;
}

/** A napló sora (a dátum a platformé): cím · táv · menetidő · átlag. */
export function tripRowParts(trip: Trip, unit: SpeedUnit): { title: string; distance: string; duration: string; avg: string } {
  return {
    title: tripTitle(trip),
    distance: distText(trip.distanceM, unit),
    duration: formatTripDuration(trip.movingS),
    avg: tripSpeedText(tripAvgKmh(trip), unit),
  };
}

/** A kanyarok egy sorban: „B 12 · J 9 · U 1”. */
export const turnsText = (turns: TripTurns): string => t('trips.turnsValue', { l: turns.left, r: turns.right, u: turns.uTurn });

/** Szakaszmérések: „3 rendben · 1 túl gyors”. */
export const checksText = (ok: number, tooFast: number): string => t('trips.checksValue', { ok, fast: tooFast });

/** Időtartam a statisztikához (0 is: „0 perc”). */
export const tripDurationText = (s: number): string => (s < 30 ? t('nav.dur.min', { n: 0 }) : formatTripDuration(s));

/** A szakasz neve a mérés-rekordban: „M1 · Budapest → Győr” (irány nélkül csak az út). */
export const measurementName = (s: { road: string; direction?: string | null }): string => (s.direction ? `${s.road} · ${s.direction}` : s.road);
