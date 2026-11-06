import { LocalProjection, meterBar, Route, type GpsFix, type LatLon, type Section } from '@atlagsebesseg/core';
import type { FixedCamera } from '../src/cameras';
import { PLANNED_MATCH_M, type PlannedCheck } from '../src/plannedChecks';
import { voiceInstructionsHint } from '../src/display';
import { TrackingSession } from '../src/session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDAPEST_GYOR_DIRECTIONS } from '../src/navigation/fixtures';
import {
  absorbArrivalStub,
  addRecent,
  displayPlace,
  forgetPlaceNames,
  placesNeedingNames,
  reverseGeocodeUrl,
  setSavedPlace,
  addSavedOther,
  adjustedDurations,
  ALT_OFFER,
  altOfferCompactLines,
  altOfferTitle,
  altOfferVoice,
  altWorth,
  CAMERA_ALERT,
  cameraAlertM,
  detourCostPerKm,
  removeSavedOther,
  placeKey,
  routeAvgKmh,
  routeTarget,
  savedChips,
  thenText,
  ALT_LABEL_PLACE,
  compactMeterBarText,
  slowDownBarShown,
  altDeltaText,
  altOfferCompactText,
  mercatorScreen,
  navBottomShowsSpeed,
  navMeterCompact,
  navSpeedOver,
  placeAltLabel,
  type Px,
  altLabels,
  divergenceAlongM,
  congestionRuns,
  cumulative,
  DirectionsClient,
  DirectionsError,
  directionsUrl,
  applyCommunityJams,
  fastestRouteIndex,
  JamDetector,
  jamSample,
  rerouteRetryDelayMs,
  routeErrorKind,
  routeTagText,
  TRAFFIC,
  type CommunityJam,
  geocodeUrl,
  limitAt,
  maneuverIcon,
  NavigationSession,
  manualPillTap,
  manualPillTick,
  MANUAL_PILL,
  navNeedsSpace,
  navResultCompact,
  navStepStrip,
  NAV_CONFIG,
  firstNewManeuver,
  parseDirections,
  parseGeocode,
  parseRecents,
  parseSaved,
  RequestCounter,
  remainingSeconds,
  ROUTE_MATCH_M,
  routeEnforcement,
  routeSummary,
  SearchController,
  selectRouteById,
  shouldSearch,
  routeDelayS,
  routeOrder,
  routeTimeline,
  localMatches,
  parseRetrieve,
  parseSuggest,
  retrieveUrl,
  SearchSession,
  suggestUrl,
  type EnforcementItem,
  permittedKmhAt,
  highwayAt,
  nearStopPoint,
  type JamContext,
  type NavRoute,
  type RouteFetcher,
  type SavedPlaces,
  type SearchState,
  type SyncStore,
} from '../src/navigation';
import { DICTIONARIES, LANGUAGES, setLanguage, t } from '../src/i18n';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings';
import { followFocusY, followZoom } from '../src/follow';
import { NO_ENFORCEMENT_DATA } from '../src/navigation/enforcement';

afterEach(() => setLanguage('hu'));

// ---------------------------------------------------------------------------
// segédek
// ---------------------------------------------------------------------------

const T0 = 1_800_000_000_000;
const ORIGIN: LatLon = { lat: 47.5, lon: 19.0 };

/** Egyenes, kelet felé futó teszt-útvonal: `lengthM` hosszú, `durationS` idejű, lépésenként 1 km. */
function lineRoute(opts: { lengthM?: number; durationS?: number; latOffset?: number; limit?: number | null; id?: string; startX?: number } = {}): NavRoute {
  const lengthM = opts.lengthM ?? 10_000;
  const durationS = opts.durationS ?? 360;
  const proj = new LocalProjection({ lat: ORIGIN.lat + (opts.latOffset ?? 0), lon: ORIGIN.lon });
  const n = Math.round(lengthM / 100);
  // AW18: `startX` – a kelet felé futó egyenes ennyi méterrel később indul (a friss, a jelenlegi pozíciótól kért útvonal)
  const points = Array.from({ length: n + 1 }, (_, i) => proj.fromXY({ x: (opts.startX ?? 0) + (i * lengthM) / n, y: 0 }));
  const km = Math.ceil(lengthM / 1000);
  const steps = Array.from({ length: km }, (_, i) => {
    const last = i === km - 1;
    const dist = Math.min(1000, lengthM - i * 1000);
    return {
      index: i,
      distanceM: dist,
      durationS: (durationS * dist) / lengthM,
      startM: i * 1000,
      name: 'M1',
      durationTypicalS: null,
      roadClass: null,
      endManeuver: { type: last ? 'arrive' : 'turn', modifier: last ? null : 'right', instruction: last ? 'Megérkezett' : 'Forduljon jobbra', location: points[(i + 1) * 10]! },
      banners: [
        { distanceAlongM: dist, primary: { text: `Kilométer ${i + 1}`, type: last ? 'arrive' : 'turn', modifier: last ? null : 'right' }, secondary: null, sub: null },
        { distanceAlongM: 300, primary: { text: `Kilométer ${i + 1} közel`, type: last ? 'arrive' : 'turn', modifier: last ? null : 'right' }, secondary: null, sub: null },
      ],
      voice: [
        { distanceAlongM: dist, text: `Hamarosan ${i + 1}` },
        { distanceAlongM: 200, text: `Most ${i + 1}` },
      ],
    };
  });
  return {
    id: opts.id ?? 'line',
    points,
    distanceM: lengthM,
    durationS,
    typicalDurationS: durationS,
    steps,
    segStartM: points.slice(0, -1).map((_, i) => (i * lengthM) / n),
    segLimitKmh: Array.from({ length: n }, () => (opts.limit === undefined ? 90 : opts.limit)),
    segCongestion: Array.from({ length: n }, () => 'low' as const),
    segDurationS: Array.from({ length: n }, () => durationS / n),
    stopPointsM: [],
  };
}

/** A teszt-útvonal egy pontja (m-ben az elejétől), `crossM` méterrel északra eltolva. */
function at(route: NavRoute, alongM: number, crossM = 0, t = T0, extra: Partial<GpsFix> = {}): GpsFix {
  const proj = new LocalProjection(route.points[0]!);
  const p = proj.fromXY({ x: alongM, y: crossM });
  return { lat: p.lat, lon: p.lon, timestamp: t, speed: 25, accuracy: 5, heading: 90, ...extra };
}

const scaleDurations = (r: NavRoute, totalS: number, id: string, latOffset = 0): NavRoute => {
  const f = totalS / r.segDurationS.reduce((a, b) => a + b, 0);
  const moved = { ...r, id, points: r.points.map((p) => ({ lat: p.lat + latOffset, lon: p.lon })) };
  return { ...moved, durationS: totalS, segDurationS: r.segDurationS.map((d) => d * f) };
};

function makeSection(route: NavRoute, fromM: number, toM: number, opts: { limit?: number; id?: string; reverse?: boolean; crossM?: number } = {}): Section {
  const a = at(route, fromM, opts.crossM ?? 0);
  const b = at(route, toM, opts.crossM ?? 0);
  const [start, end] = opts.reverse ? [b, a] : [a, b];
  return {
    id: opts.id ?? 'sec',
    country: 'HU',
    road: 'M1',
    direction: 'Teszt',
    start: { lat: start.lat, lon: start.lon },
    end: { lat: end.lat, lon: end.lon },
    lengthM: toM - fromM,
    speedLimitKmh: opts.limit ?? 110,
    source: 'hivatalos',
    verified: true,
  };
}

interface Harness {
  session: NavigationSession;
  calls: { reason: string; from: LatLon; to: LatLon; via: LatLon | null; t: number }[];
  clock: { t: number };
  respond: (r: NavRoute[] | Error) => void;
  /** AW18: a session naplója (az újratervezés hibájának oka). */
  logs: string[];
}

/** Munkamenet kézzel léptetett órával; a `fetchRoutes` hívásait rögzíti, a választ a teszt adja. */
function harness(route: NavRoute, opts: { voice?: boolean; reply?: () => NavRoute[]; routable?: LatLon } = {}): Harness {
  const clock = { t: T0 };
  const calls: Harness['calls'] = [];
  let next: NavRoute[] | Error = [route];
  const fetchRoutes: RouteFetcher = async (from, to, ctx) => {
    calls.push({ reason: ctx.reason, from, to, via: ctx.via ?? null, t: clock.t });
    const r = opts.reply ? opts.reply() : next;
    if (r instanceof Error) throw r;
    return r;
  };
  const dest = { name: 'Cél', ...route.points.at(-1)!, ...(opts.routable ? { routable: opts.routable } : {}) };
  const logs: string[] = [];
  const session = new NavigationSession(route, dest, { fetchRoutes, now: () => clock.t, voice: opts.voice ?? true, log: (m) => logs.push(m) });
  return { session, calls, clock, respond: (r) => (next = r), logs };
}

const feed = (h: Harness, fix: GpsFix) => {
  h.clock.t = fix.timestamp;
  return h.session.onFix(fix);
};

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Directions feldolgozása (rögzített, valódi válasz)
// ---------------------------------------------------------------------------

describe('Directions-válasz feldolgozása (Budapest → Győr fixtúra)', () => {
  const routes = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx');
  const r = routes[0]!;

  it('két útvonal, lépésekkel, annotációkkal', () => {
    expect(routes).toHaveLength(2);
    expect(r.distanceM).toBeGreaterThan(100_000);
    expect(r.steps.length).toBeGreaterThan(5);
    expect(r.segLimitKmh).toHaveLength(r.points.length - 1);
    expect(r.segCongestion).toHaveLength(r.points.length - 1);
    expect(r.segDurationS).toHaveLength(r.points.length - 1);
    expect(r.steps.at(-1)!.endManeuver.type).toBe('arrive');
  });

  it('a lépések összhossza az útvonal hossza, a kezdetük növekvő', () => {
    const sum = r.steps.reduce((s, x) => s + x.distanceM, 0);
    expect(Math.abs(sum - r.distanceM)).toBeLessThan(r.distanceM * 0.01);
    r.steps.forEach((s, i) => i && expect(s.startM).toBeGreaterThan(r.steps[i - 1]!.startM));
  });

  it('a maxspeed-annotáció km/h-ra váltva; az ismeretlen null', () => {
    const known = r.segLimitKmh.filter((x) => x !== null);
    const unknown = r.segLimitKmh.filter((x) => x === null);
    expect(known.length).toBeGreaterThan(100);
    expect(unknown.length).toBeGreaterThan(0);
    expect(Math.max(...(known as number[]))).toBe(130);
    expect(limitAt(r, r.distanceM * 0.5)).not.toBeUndefined();
  });

  it('a szalag- és a hangutasítások rendezettek (csökkenő távolság)', () => {
    for (const s of r.steps) {
      s.banners.forEach((b, i) => i && expect(b.distanceAlongM).toBeLessThanOrEqual(s.banners[i - 1]!.distanceAlongM));
      s.voice.forEach((v, i) => i && expect(v.distanceAlongM).toBeLessThanOrEqual(s.voice[i - 1]!.distanceAlongM));
    }
    expect(r.steps[0]!.voice.length).toBeGreaterThan(0);
  });

  it('dugó-szakaszok és késés', () => {
    const runs = congestionRuns(r);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((x) => x.points.length >= 2)).toBe(true);
    expect(routeDelayS(r)).toBeLessThanOrEqual(Math.max(0, Math.round(r.durationS - (r.typicalDurationS ?? r.durationS))));
  });

  it('hibás válaszra DirectionsError', () => {
    expect(() => parseDirections({ code: 'NoRoute', message: 'x' })).toThrow(/NoRoute|x/);
    expect(() => parseDirections(null)).toThrow();
    expect(() => parseDirections({ code: 'Ok', routes: [] })).toThrow(/NoRoute/);
  });

  it('a kérés címe: minden kért paraméter', () => {
    const u = new URL(directionsUrl({ lat: 47.5, lon: 19.04 }, { lat: 47.69, lon: 17.65 }, 'hu', 'pk.x', { heading: 87.6 }));
    expect(u.pathname).toContain('/directions/v5/mapbox/driving-traffic/19.040000,47.500000;17.650000,47.690000');
    const q = u.searchParams;
    expect(q.get('alternatives')).toBe('true');
    expect(q.get('steps')).toBe('true');
    expect(q.get('banner_instructions')).toBe('true');
    expect(q.get('voice_instructions')).toBe('true');
    expect(q.get('annotations')).toBe('maxspeed,congestion,duration');
    expect(q.get('language')).toBe('hu');
    expect(q.get('bearings')).toBe('88,45;');
  });
});

// ---------------------------------------------------------------------------
// Illesztés, lépésváltás
// ---------------------------------------------------------------------------

describe('pozíció-illesztés és lépésváltás', () => {
  it('az útvonalra illeszt: hátralévő táv, keresztirányú eltérés', () => {
    const route = lineRoute();
    const h = harness(route);
    const v = feed(h, at(route, 4000, 20));
    expect(v.alongM).toBeCloseTo(4000, -1);
    expect(v.crossM).toBeCloseTo(20, -1);
    expect(v.remainingM).toBeCloseTo(6000, -1);
  });

  it('a következő manőver távolsága a lépés végéig számol, lépésváltáskor a következő lépésre ugrik', () => {
    const route = lineRoute();
    const h = harness(route);
    let v = feed(h, at(route, 2300, 0, T0 + 1000));
    expect(v.next.distanceM).toBeCloseTo(700, -1);
    expect(v.next.text).toBe('Kilométer 3');
    expect(v.then?.text).toMatch(/Kilométer 4/);
    v = feed(h, at(route, 3050, 0, T0 + 2000));
    expect(v.next.text).toBe('Kilométer 4');
    expect(v.next.distanceM).toBeCloseTo(950, -1);
  });

  it('a szalag a közelítéssel pontosodik (kisebb küszöbű szalag a lépés végén)', () => {
    const route = lineRoute();
    const h = harness(route);
    expect(feed(h, at(route, 100, 0, T0 + 1000)).next.text).toBe('Kilométer 1');
    expect(feed(h, at(route, 800, 0, T0 + 2000)).next.text).toBe('Kilométer 1 közel');
  });

  it('a sebességhatár az útvonal annotációjából jön; ha nincs: null', () => {
    const known = harness(lineRoute({ limit: 110 }));
    expect(feed(known, at(known.session.view().route, 500)).limitKmh).toBe(110);
    const unknown = harness(lineRoute({ limit: null }));
    expect(feed(unknown, at(unknown.session.view().route, 500)).limitKmh).toBeNull();
  });

  it('érkezés: a céltól 30 m-en belül', () => {
    const route = lineRoute();
    const h = harness(route);
    expect(feed(h, at(route, 9000, 0, T0 + 1000)).phase).toBe('navigating');
    const v = feed(h, at(route, 9980, 0, T0 + 2000));
    expect(v.phase).toBe('arrived');
    expect(v.remainingS).toBe(0);
  });

  it('a fixtúra-útvonalon: a közepén a lépés és a határ értelmes', () => {
    const r = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx')[0]!;
    const h = harness(r);
    const p = r.points[Math.floor(r.points.length / 2)]!;
    const v = feed(h, { lat: p.lat, lon: p.lon, timestamp: T0, speed: 30, accuracy: 5, heading: null });
    expect(v.crossM).toBeLessThan(5);
    expect(v.alongM).toBeGreaterThan(r.distanceM * 0.3);
    expect(v.alongM).toBeLessThan(r.distanceM * 0.7);
    expect(v.next.distanceM).toBeGreaterThan(0);
    expect(v.next.text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Letérés és újratervezés
// ---------------------------------------------------------------------------

describe('letérés-felismerés és újratervezés-korlát', () => {
  it('50 m-en belül nincs letérés', () => {
    const route = lineRoute();
    const h = harness(route);
    for (let s = 0; s < 20; s++) feed(h, at(route, 1000 + s * 20, 45, T0 + s * 1000));
    expect(h.calls).toHaveLength(0);
    expect(h.session.view().offRoute).toBe(false);
  });

  it('50 m-nél távolabb 5 mp-ig → egy újratervezés a jelenlegi pozícióból', async () => {
    const route = lineRoute();
    const h = harness(route);
    for (let s = 0; s <= 4; s++) feed(h, at(route, 2000, 200, T0 + s * 1000));
    expect(h.calls).toHaveLength(0); // 4 mp: még nem
    expect(h.session.view().offRoute).toBe(true);
    feed(h, at(route, 2000, 200, T0 + 5000));
    expect(h.calls.map((c) => c.reason)).toEqual(['reroute']);
    expect(h.session.view().rerouting).toBe(true);
    const p = at(route, 2000, 200);
    expect(h.calls[0]!.from.lat).toBeCloseTo(p.lat, 6);
    await flush();
    expect(h.session.view().rerouting).toBe(false);
  });

  it('egy 3 mp-es kitérő nem indít újratervezést', () => {
    const route = lineRoute();
    const h = harness(route);
    for (let s = 0; s < 3; s++) feed(h, at(route, 2000, 200, T0 + s * 1000));
    for (let s = 3; s < 12; s++) feed(h, at(route, 2000, 5, T0 + s * 1000));
    expect(h.calls).toHaveLength(0);
  });

  it('AW18: sikertelen újratervezés után növekvő várakozással próbál újra (5 → 10 → 20 → 30 → 30 s), a kártya a hátralévő másodpercet mutatja, az ok a naplóba', async () => {
    const route = lineRoute();
    const h = harness(route, { voice: false });
    h.respond(new DirectionsError('http_503'));
    for (let s = 0; s <= 130; s++) {
      feed(h, at(route, 2000, 300, T0 + s * 1000));
      await flush();
      if (s === 7) expect(h.session.view().rerouteRetryInS).toBe(3);
    }
    // 5 s letérés → 1. próba; utána 5, 10, 20, 30, 30 s várakozás
    expect(h.calls.map((c) => (c.t - T0) / 1000)).toEqual([5, 10, 20, 40, 70, 100, 130]);
    expect(h.session.view().rerouteFailed).toBe(true);
    expect(h.logs[0]).toContain('http_503');
    expect(h.logs).toHaveLength(7);
  });

  it('AW18: koppintásra azonnal újrapróbál; visszatérve az útvonalra a hiba-kártya eltűnik', async () => {
    const route = lineRoute();
    const h = harness(route, { voice: false });
    h.respond(new Error('hálózat'));
    for (let s = 0; s <= 12; s++) {
      feed(h, at(route, 2000, 300, T0 + s * 1000));
      await flush();
    }
    // próbák: 5 s, 10 s (a következő a 20. s-nál lenne)
    expect(h.calls).toHaveLength(2);
    expect(h.session.view().rerouteRetryInS).toBe(8);
    h.clock.t = T0 + 16_000;
    h.session.retryReroute();
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2]!.t).toBe(T0 + 16_000);
    await flush();
    expect(h.logs.at(-1)).toContain('network');
    // az előző hívás után 5 s-on belül a koppintás a korlát leteltét várja (a visszaszámlálás ezt mutatja)
    h.clock.t = T0 + 18_000;
    h.session.retryReroute();
    expect(h.calls).toHaveLength(3);
    expect(h.session.view().rerouteRetryInS).toBe(3);
    // vissza az útvonalra: nincs több próba, a kártya eltűnik
    feed(h, at(route, 2100, 0, T0 + 17_000));
    expect(h.session.view().rerouteFailed).toBe(false);
    expect(h.session.view().rerouteRetryInS).toBeNull();
  });

  it('az új útvonal átveszi a helyet: routeVersion nő, a letérés megszűnik', async () => {
    const route = lineRoute();
    const fresh = lineRoute({ id: 'uj', latOffset: 0.0027, lengthM: 8000 }); // ~300 m-rel északabbra
    const h = harness(route);
    h.respond([fresh]);
    const before = h.session.view().routeVersion;
    for (let s = 0; s <= 5; s++) feed(h, { ...at(route, 2000, 300, T0 + s * 1000) });
    await flush();
    const v = h.session.view();
    expect(v.routeVersion).toBeGreaterThan(before);
    expect(v.route.id).toBe('uj');
    feed(h, at(fresh, 100, 0, T0 + 7000));
    expect(h.session.view().offRoute).toBe(false);
  });

  it('Directions-hívás legfeljebb 5 mp-enként: a letérés nem indít hívást közvetlenül egy másik után', async () => {
    const route = lineRoute();
    const h = harness(route, { voice: false });
    h.session.tick();
    // alternatíva-figyelés esedékes (2 perc), közvetlenül utána letérés
    feed(h, at(route, 1000, 0, T0 + 120_000));
    expect(h.calls.map((c) => c.reason)).toEqual(['alternatives']);
    for (let s = 1; s <= 8; s++) feed(h, at(route, 1000, 400, T0 + 120_000 + s * 1000));
    await flush();
    const reroutes = h.calls.filter((c) => c.reason === 'reroute');
    expect(reroutes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Alternatíva-figyelés
// ---------------------------------------------------------------------------

/** A Budapest→Győr alternatívája ennyi nyereséggel „Lehet” (a 7,3 km-es kerülő ára ~2,3 perc), 130 s-mal „Nem éri meg”. */
const MAYBE_GAIN_S = 240;
const NOT_GAIN_S = 130;

describe('alternatíva-figyelés', () => {
  it('2 percenként kér, előtte nem', () => {
    const route = lineRoute();
    const h = harness(route);
    feed(h, at(route, 500, 0, T0 + 60_000));
    feed(h, at(route, 600, 0, T0 + 119_000));
    expect(h.calls).toHaveLength(0);
    feed(h, at(route, 700, 0, T0 + 120_000));
    expect(h.calls.map((c) => c.reason)).toEqual(['alternatives']);
  });

  /** Egy 30 perces útvonal; a válaszban a változatlan útvonal és egy alternatíva a megadott idővel. */
  async function offerWith(altDurationS: number, baseS = 1800) {
    const route = lineRoute({ lengthM: 40_000, durationS: baseS });
    const alt = scaleDurations(lineRoute({ lengthM: 42_000, durationS: baseS, id: 'alt' }), altDurationS, 'alt', 0.003);
    const h = harness(route);
    h.respond([route, alt]);
    feed(h, at(route, 500, 0, T0 + 120_000));
    await flush();
    return h.session.view().offer;
  }

  it('legalább 2 perc nyereség → ajánlat (AW12: a 15%-os szabály nincs)', async () => {
    const offer = await offerWith(3600 - ALT_OFFER.minGainS, 3600);
    expect(offer).not.toBeNull();
    expect(offer!.gainS).toBeGreaterThanOrEqual(120);
    expect(offer!.route.id).toBe('alt');
  });

  it('2 percnél kevesebb nyereség → nincs ajánlat, rövid úton sem', async () => {
    expect(await offerWith(3600 - 110, 3600)).toBeNull();
    // 10 perces út, 1,8 perc (18%) – régen ajánlat lett volna
    expect(await offerWith(600 - 108, 600)).toBeNull();
  });

  /**
   * A Budapest→Győr fixtúra: a jelenlegi útvonal és az igazi alternatíva (`gainS`-sel gyorsabbra skálázva: 600 s →
   * „Megéri”, {@link MAYBE_GAIN_S} → „Lehet”); a lehajtója a 67. kilométernél van.
   */
  const fixture = (gainS = 600) => {
    const [main, other] = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx') as [NavRoute, NavRoute];
    const core = new Route(main.points, main.distanceM);
    const alt = scaleDurations(other, main.durationS - gainS, 'alt');
    const sectionOn = (fromM: number, toM: number): Section => {
      const a = core.pointAt(fromM);
      const b = core.pointAt(toM);
      return { ...makeSection(lineRoute(), 0, 1000), start: a, end: b, lengthM: toM - fromM };
    };
    const fix = (alongM: number, t: number): GpsFix => ({ ...core.pointAt(alongM), timestamp: t, speed: 25, accuracy: 5, heading: null });
    return { main, alt, sectionOn, fix };
  };

  async function measuringOn(sectionToM: number, gainS = 600) {
    const f = fixture(gainS);
    const h = harness(f.main);
    h.session.setData({ sections: [f.sectionOn(400, sectionToM)], cameras: [], planned: [] });
    h.respond([f.main, f.alt]);
    h.session.setMeasuring(true);
    feed(h, f.fix(1000, T0 + 120_000));
    await flush();
    return { h, f };
  }

  it('lehajtó = az alternatíva első, a jelenlegi útvonalon nem szereplő manővere', () => {
    const { main, alt } = fixture();
    const exit = firstNewManeuver(main, alt);
    expect(exit).not.toBeNull();
    expect(exit!.distanceM).toBeGreaterThan(66_000);
    expect(exit!.distanceM).toBeLessThan(68_000);
    // a banner többi része (itt a cél-név, „Tata”) nem tapad a kijárat nevére
    expect(exit!.name).toBe('Kijárat 67');
    expect(alt.steps.some((s) => s.banners[0]?.primary.text === 'Kijárat 67 Tata')).toBe(true);
    // önmagával nincs eltérés
    expect(firstNewManeuver(main, main)).toBeNull();
  });

  it('kézi mérés közben nincs ajánlat; a mérés végén jelenik meg, onnan 45 mp', async () => {
    const { main: route, alt, fix } = fixture();
    const h = harness(route);
    h.respond([route, alt]);
    h.session.setMeasuring(true);
    feed(h, fix(500, T0 + 120_000));
    await flush();
    expect(h.session.view().offer).toBeNull();
    expect(h.session.drainVoice().some((v) => v.kind === 'faster')).toBe(false);
    // hosszú mérés: a visszatartott ajánlat nem évül el
    feed(h, fix(900, T0 + 400_000));
    expect(h.session.view().offer).toBeNull();
    h.session.setMeasuring(false);
    const offer = h.session.view().offer;
    expect(offer).not.toBeNull();
    expect(offer!.expiresAt).toBe(T0 + 400_000 + NAV_CONFIG.offerTtlMs);
    expect(h.session.drainVoice().some((v) => v.kind === 'faster')).toBe(true);
  });

  it('lehajtó-név: kijárat → cél-név → nincs', () => {
    const { main, alt } = fixture();
    const withBanner = (edit: (b: NavRoute['steps'][number]['banners'][number]) => void): NavRoute => {
      const copy: NavRoute = structuredClone(alt);
      const step = copy.steps.find((s) => s.banners[0]?.primary.exit === 'Kijárat 67')!;
      edit(step.banners[0]!);
      return copy;
    };
    expect(firstNewManeuver(main, alt)!.name).toBe('Kijárat 67');
    // a felvételben ennek a lehajtónak nincs második sora: a cél-nevet a teszt adja
    const dest = { text: 'Tata', type: 'off ramp', modifier: 'right', exit: null };
    expect(firstNewManeuver(main, withBanner((b) => ((b.primary.exit = null), (b.secondary = dest))))!.name).toBe('Tata');
    expect(firstNewManeuver(main, withBanner((b) => ((b.primary.exit = null), (b.secondary = null))))!.name).toBeNull();
  });

  it('mérés közben: a lehajtó a szakasz vége előtt → azonnal, kompakt ajánlat a lehajtó nevével és távolságával', async () => {
    const { h } = await measuringOn(70_000);
    const offer = h.session.view().offer;
    expect(offer).not.toBeNull();
    expect(offer!.compact).toBe(true);
    expect(offer!.exitName).toBe('Kijárat 67');
    expect(offer!.exitInM).toBeGreaterThan(66_000);
    expect(offer!.expiresAt).toBe(T0 + 120_000 + NAV_CONFIG.offerTtlMs);
    const voice = h.session.drainVoice().filter((v) => v.kind === 'faster');
    expect(voice).toHaveLength(1);
    expect(voice[0]!.text).toBe(altOfferVoice(altWorth(offer!.gainS, offer!.extraM, routeAvgKmh(offer!.route)), offer!.exitKm));
    // a mérés végén a forma nem kompakt, az ajánlat marad
    h.session.setMeasuring(false);
    expect(h.session.view().offer!.compact).toBe(false);
  });

  it('mérés közben: a lehajtó a szakasz vége után → visszatartva, a mérés végén jelenik meg', async () => {
    const { h } = await measuringOn(20_000);
    expect(h.session.view().offer).toBeNull();
    expect(h.session.drainVoice().some((v) => v.kind === 'faster')).toBe(false);
    h.session.setMeasuring(false);
    expect(h.session.view().offer).not.toBeNull();
  });

  it('bemondás Waze-mintára („Lehet”): azonnal, majd 500 m-nél még egyszer', async () => {
    const { h, f } = await measuringOn(70_000, MAYBE_GAIN_S);
    expect(h.session.view().offer!.verdict).toBe('maybe');
    const exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM;
    expect(h.session.drainVoice().filter((v) => v.kind === 'faster')).toHaveLength(1);
    feed(h, f.fix(exitAlong - 2000, T0 + 125_000));
    expect(h.session.drainVoice().filter((v) => v.kind === 'faster')).toHaveLength(0);
    feed(h, f.fix(exitAlong - 450, T0 + 130_000));
    const second = h.session.drainVoice().filter((v) => v.kind === 'faster');
    expect(second.map((v) => v.text)).toEqual([t('nav.voice.fasterExit500')]);
    feed(h, f.fix(exitAlong - 300, T0 + 132_000));
    expect(h.session.drainVoice().filter((v) => v.kind === 'faster')).toHaveLength(0);
  });

  it('a lehajtót 50 m-rel elhagyva az ajánlat eltűnik („Lehet”)', async () => {
    const { h, f } = await measuringOn(70_000, MAYBE_GAIN_S);
    const exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM;
    feed(h, f.fix(exitAlong - 100, T0 + 130_000));
    expect(h.session.view().offer).not.toBeNull();
    feed(h, f.fix(exitAlong + 80, T0 + 131_000));
    expect(h.session.view().offer).toBeNull();
  });

  it('elfogadás: az alternatíva veszi át; elvetés: ugyanaz nem jön vissza', async () => {
    const route = lineRoute({ lengthM: 40_000, durationS: 1800 });
    const alt = scaleDurations(lineRoute({ lengthM: 42_000, durationS: 1800, id: 'alt' }), 1200, 'alt', 0.003);
    const h = harness(route);
    h.respond([route, alt]);
    feed(h, at(route, 500, 0, T0 + 120_000));
    await flush();
    h.session.declineOffer();
    expect(h.session.view().offer).toBeNull();
    feed(h, at(route, 900, 0, T0 + 240_000));
    await flush();
    expect(h.session.view().offer).toBeNull(); // elvetett: nem ajánljuk újra
    // másik, új alternatíva viszont igen
    const alt2 = scaleDurations(lineRoute({ lengthM: 43_000, durationS: 1800, id: 'alt2' }), 1000, 'alt2', -0.004);
    h.respond([route, alt2]);
    feed(h, at(route, 1300, 0, T0 + 360_000));
    await flush();
    expect(h.session.view().offer?.route.id).toBe('alt2');
    const version = h.session.view().routeVersion;
    h.session.acceptOffer();
    expect(h.session.view().route.id).toBe('alt2');
    expect(h.session.view().routeVersion).toBeGreaterThan(version);
    expect(h.session.view().offer).toBeNull();
  });

  it('AW17: a „Megéri” ajánlat a lehajtó előtt 500 m-en belül magától elfogad, a 45 s kivárása nélkül; a hang a kézi elfogadásé', async () => {
    const { h, f } = await measuringOn(70_000);
    expect(h.session.view().offer!.verdict).toBe('worth');
    const exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM;
    feed(h, f.fix(exitAlong - 600, T0 + 125_000));
    expect(h.session.view().offer).not.toBeNull();
    h.session.drainVoice();
    // 10 s-mal az ajánlat után (a 45 s-ból még bőven van), 450 m-rel a lehajtó előtt
    const v = feed(h, f.fix(exitAlong - 450, T0 + 130_000));
    expect(v.offer).toBeNull();
    expect(v.route.id).toBe('alt');
    const auto = h.session.drainVoice();
    // nincs külön „Gyorsabb út, lehajtó 500 méternél”: a váltás után az új útvonal szól, mint kézi elfogadásnál
    expect(auto.some((x) => x.kind === 'faster')).toBe(false);
    const manual = await measuringOn(70_000);
    feed(manual.h, manual.f.fix(exitAlong - 600, T0 + 125_000));
    manual.h.session.drainVoice();
    manual.h.session.acceptOffer();
    feed(manual.h, manual.f.fix(exitAlong - 450, T0 + 130_000));
    expect(auto.map((x) => [x.kind, x.text])).toEqual(manual.h.session.drainVoice().map((x) => [x.kind, x.text]));
  });

  it('AW17: „Lehet” és „Nem éri meg” ajánlatnál 500 m-en belül sincs automatikus váltás', async () => {
    for (const [gainS, verdict] of [
      [MAYBE_GAIN_S, 'maybe'],
      [NOT_GAIN_S, 'not'],
    ] as const) {
      const { h, f } = await measuringOn(70_000, gainS);
      expect(h.session.view().offer!.verdict, verdict).toBe(verdict);
      const exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM;
      const v = feed(h, f.fix(exitAlong - 300, T0 + 130_000));
      expect(v.offer?.verdict, verdict).toBe(verdict);
      expect(v.route.id, verdict).toBe(f.main.id);
    }
  });

  it('a le nem kezelt ajánlat lejár', async () => {
    const route = lineRoute({ lengthM: 40_000, durationS: 1800 });
    const alt = scaleDurations(lineRoute({ lengthM: 42_000, durationS: 1800, id: 'alt' }), 1200, 'alt', 0.003);
    const h = harness(route);
    h.respond([route, alt]);
    feed(h, at(route, 500, 0, T0 + 120_000));
    await flush();
    expect(h.session.view().offer).not.toBeNull();
    feed(h, at(route, 600, 0, T0 + 120_000 + NAV_CONFIG.offerTtlMs + 1));
    expect(h.session.view().offer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Szakaszellenőrzés az útvonalon, ETA
// ---------------------------------------------------------------------------

describe('szakaszok az útvonal sávjában', () => {
  const route = lineRoute();
  const data = (over: Partial<{ sections: Section[] }> = {}) => ({ sections: [], cameras: [], planned: [], ...over });

  it('a 40 m-es sávban lévő szakasz bekerül, az 100 m-re lévő nem', () => {
    const near = makeSection(route, 2000, 6000, { id: 'kozel', crossM: 20 });
    const far = makeSection(route, 2000, 6000, { id: 'messze', crossM: 100 });
    const items = routeEnforcement(route, data({ sections: [near, far] }), T0);
    expect(items.map((i) => i.id)).toEqual(['kozel']);
    expect(items[0]!.startM).toBeCloseTo(2000, -1);
    expect(items[0]!.endM).toBeCloseTo(6000, -1);
  });

  it('a tervezett mérés is a 40 m-es (ROUTE_MATCH_M) sávval kerül az útra, nem a sáv 100 m-es tűrésével', () => {
    expect(ROUTE_MATCH_M).toBe(40);
    expect(NAV_CONFIG.enforcementBandM).toBe(ROUTE_MATCH_M);
    expect(PLANNED_MATCH_M).toBe(100);
    const planned = (id: string, crossM: number): PlannedCheck => ({
      id,
      country: 'HU',
      county: 'Fejér',
      settlement: null,
      roadRef: 'M1',
      description: '',
      lines: [[at(route, 3000, crossM), at(route, 5000, crossM)]],
      zones: [],
      speedLimitKmh: 90,
      limitSource: 'osm',
      validFrom: T0 - 86_400_000,
      validTo: T0 + 86_400_000,
      timeWindow: null,
      sourceUrl: 'https://www.police.hu/',
    });
    const items = routeEnforcement(route, { sections: [], cameras: [], planned: [planned('kozel', 20), planned('parhuzamos', 70)] }, T0);
    expect(items.map((i) => i.id)).toEqual(['kozel']);
    expect(items[0]!.startM).toBeCloseTo(3000, -2);
    expect(items[0]!.endM).toBeCloseTo(5000, -2);
  });

  it('az ellenkező irányú szakasz nem kerül be', () => {
    const rev = makeSection(route, 2000, 6000, { reverse: true });
    expect(routeEnforcement(route, data({ sections: [rev] }), T0)).toEqual([]);
  });

  it('a kamera láthatósága érvényes: HU látszik, FR (zóna) és CH (rejtett) nem kerül a listára', () => {
    const p = at(route, 5000, 10);
    const cam = (id: string, country: string) =>
      ({ id, country, type: 'speed', lat: p.lat, lon: p.lon, headingDeg: 90, road: 'M1', speedLimitKmh: 130, source: '', sourceUrl: '', sourceDate: '', verified: true }) satisfies FixedCamera;
    const items = routeEnforcement(route, { sections: [], cameras: [cam('hu', 'HU'), cam('fr', 'FR'), cam('ch', 'CH')], planned: [] }, T0);
    expect(items.map((i) => i.id)).toEqual(['hu']);
    expect(items[0]!.kind).toBe('camera');
  });

  it('összefoglaló: szakaszok, kamerák száma, dugó-többlet', () => {
    const s = makeSection(route, 2000, 6000);
    const p = at(route, 8000, 5);
    const cam = { id: 'c', country: 'HU', type: 'speed', lat: p.lat, lon: p.lon, headingDeg: null, road: 'M1', speedLimitKmh: null, source: '', sourceUrl: '', sourceDate: '', verified: true } satisfies FixedCamera;
    const sum = routeSummary({ ...route, durationS: 420, typicalDurationS: 360 }, { sections: [s], cameras: [cam], planned: [] }, T0);
    expect(sum.sections).toBe(1);
    expect(sum.cameras).toBe(1);
    // AW23: heavy / severe szakasz nélkül nincs dugó-többlet, akkor sem, ha a Mapbox a tipikusnál többet ad
    expect(sum.delayS).toBe(0);
  });
});

describe('ETA a szakaszokon a határral', () => {
  // 10 km 360 s-ban (100 km/h); 2–6 km között szakasz, határ 60 km/h
  const route = lineRoute({ lengthM: 10_000, durationS: 360 });
  const section = makeSection(route, 2000, 6000, { limit: 60 });

  it('a szakasz ideje a határ szerint (4 km @ 60 = 240 s a 144 s helyett)', () => {
    const items = routeEnforcement(route, { sections: [section], cameras: [], planned: [] }, T0);
    const cum = cumulative(adjustedDurations(route, items));
    expect(cum.at(-1)!).toBeCloseTo(360 - 144 + 240, 0);
    expect(remainingSeconds(route, cum, 0)).toBeCloseTo(456, 0);
    expect(remainingSeconds(route, cum, 6000)).toBeCloseTo(144, 0);
    expect(remainingSeconds(route, cum, 10_000)).toBe(0);
  });

  it('a szakaszon, ahol az útvonal lassabb a határnál, nem gyorsít', () => {
    const slow = lineRoute({ lengthM: 10_000, durationS: 900 }); // 40 km/h
    const items = routeEnforcement(slow, { sections: [makeSection(slow, 2000, 6000, { limit: 110 })], cameras: [], planned: [] }, T0);
    expect(cumulative(adjustedDurations(slow, items)).at(-1)!).toBeCloseTo(900, 0);
  });

  it('a nézet ETA-ja és hátralévő ideje a szakaszokkal számol', () => {
    const h = harness(route);
    h.session.setData({ sections: [section], cameras: [], planned: [] });
    const v = feed(h, at(route, 0, 0, T0 + 1000));
    expect(v.remainingS).toBeCloseTo(456, -1);
    expect(v.etaMs).toBeCloseTo(h.clock.t + 456_000, -4);
    const w = feed(h, at(route, 7000, 0, T0 + 2000));
    expect(w.remainingS).toBeCloseTo(108, -1);
  });

  it('közeledő szakasz: 2 km-en belül jelzi a távolságot és a határt', () => {
    const h = harness(route);
    h.session.setData({ sections: [section, makeSection(route, 8000, 9500, { id: 'tavoli' })], cameras: [], planned: [] });
    expect(feed(h, at(route, 0, 0, T0 + 1000)).upcoming?.item.id).toBe('sec'); // pont 2 km: még jelzi
    h.session.setData({ sections: [makeSection(route, 3000, 7000, { id: 'tavoli' })], cameras: [], planned: [] });
    expect(feed(h, at(route, 0, 0, T0 + 1500)).upcoming).toBeNull(); // 3 km: a küszöbön kívül
    h.session.setData({ sections: [section], cameras: [], planned: [] });
    const v = feed(h, at(route, 400, 0, T0 + 2000));
    expect(v.upcoming?.item.kind).toBe('section');
    expect(v.upcoming?.item.limitKmh).toBe(60);
    expect(v.upcoming?.distanceM).toBeCloseTo(1600, -1);
    expect(feed(h, at(route, 2500, 0, T0 + 3000)).upcoming).toBeNull(); // már a szakaszon
  });
});

// ---------------------------------------------------------------------------
// Hang
// ---------------------------------------------------------------------------

describe('hang-események', () => {
  it('a Directions hangutasítása a küszöbnél szólal meg, egyszer', () => {
    const route = lineRoute();
    const h = harness(route);
    feed(h, at(route, 10, 0, T0 + 1000)); // 990 m a lépés végéig: a „Hamarosan 1” (1000 m) esedékes
    expect(h.session.drainVoice().map((v) => v.text)).toEqual(['Hamarosan 1']);
    feed(h, at(route, 500, 0, T0 + 2000));
    expect(h.session.drainVoice()).toEqual([]);
    feed(h, at(route, 850, 0, T0 + 3000)); // 150 m: a „Most 1” (200 m)
    expect(h.session.drainVoice().map((v) => v.text)).toEqual(['Most 1']);
    feed(h, at(route, 900, 0, T0 + 4000));
    expect(h.session.drainVoice()).toEqual([]);
  });

  it('kikapcsolt hangnál semmi nem szólal meg, és nem is halmozódik', () => {
    const route = lineRoute();
    const h = harness(route, { voice: false });
    feed(h, at(route, 10, 0, T0 + 1000));
    feed(h, at(route, 850, 0, T0 + 2000));
    expect(h.session.drainVoice()).toEqual([]);
    h.session.setVoice(true);
    feed(h, at(route, 900, 0, T0 + 3000));
    expect(h.session.drainVoice()).toEqual([]);
  });

  it('közeledő szakasz: 500 m-nél bemondja a határral, egyszer', () => {
    const route = lineRoute();
    const h = harness(route);
    h.session.setData({ sections: [makeSection(route, 5000, 9000, { limit: 110 })], cameras: [], planned: [] });
    feed(h, at(route, 4000, 0, T0 + 1000));
    h.session.drainVoice();
    feed(h, at(route, 4520, 0, T0 + 2000));
    const said = h.session.drainVoice().filter((v) => v.kind === 'section');
    expect(said).toHaveLength(1);
    expect(said[0]!.text).toBe('Szakaszellenőrzés kezdődik, maximum 110');
    feed(h, at(route, 4700, 0, T0 + 3000));
    expect(h.session.drainVoice().filter((v) => v.kind === 'section')).toEqual([]);
  });

  it('a „Túl gyors” a váltáskor szól, 30 mp-en belül nem ismétlődik', () => {
    const route = lineRoute();
    const h = harness(route);
    h.session.setMeasureStatus('jo');
    h.session.setMeasureStatus('tul_gyors');
    expect(h.session.drainVoice().map((v) => v.kind)).toEqual(['tooFast']);
    h.session.setMeasureStatus('tul_gyors');
    expect(h.session.drainVoice()).toEqual([]);
    h.session.setMeasureStatus('jo');
    h.clock.t = T0 + 10_000;
    h.session.setMeasureStatus('tul_gyors');
    expect(h.session.drainVoice()).toEqual([]); // 10 mp: még a tilalmi időn belül
    h.session.setMeasureStatus('jo');
    h.clock.t = T0 + 31_000;
    h.session.setMeasureStatus('tul_gyors');
    expect(h.session.drainVoice().map((v) => v.kind)).toEqual(['tooFast']);
  });

  it('a hangszövegek mind a 6 nyelven megvannak, a határ behelyettesítve', () => {
    for (const lang of LANGUAGES) {
      expect(t('nav.voice.sectionAhead', { x: 110 }, lang), lang).toContain('110');
      expect(t('nav.voice.faster', { n: 7 }, lang), lang).toContain('7');
      expect(t('nav.voice.tooFast', undefined, lang).length).toBeGreaterThan(3);
      expect(t('nav.voice.rerouting', undefined, lang).length).toBeGreaterThan(3);
    }
  });

  it('újratervezéskor bemondja', async () => {
    const route = lineRoute();
    const h = harness(route);
    for (let s = 0; s <= 5; s++) feed(h, at(route, 2000, 300, T0 + s * 1000));
    await flush();
    expect(h.session.drainVoice().some((v) => v.kind === 'reroute')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Keresés, helyek, számláló
// ---------------------------------------------------------------------------

describe('keresés: 3 karaktertől, 300 ms késleltetéssel', () => {
  function rig(search: (q: string) => Promise<[]> | Promise<ReturnType<typeof parseGeocode>>) {
    const timers: { fn: () => void; ms: number; id: number }[] = [];
    let n = 0;
    const states: SearchState[] = [];
    const ctl = new SearchController({
      search: search as never,
      onState: (s) => states.push(s),
      setTimer: (fn, ms) => (timers.push({ fn, ms, id: ++n }), n),
      clearTimer: (id) => {
        const i = timers.findIndex((x) => x.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    return { ctl, timers, states };
  }

  it('kevesebb mint 3 karakterre nem keres', () => {
    expect(shouldSearch('ab')).toBe(false);
    expect(shouldSearch('  ab ')).toBe(false);
    expect(shouldSearch('abc')).toBe(true);
    const search = vi.fn(async () => []);
    const { ctl, timers, states } = rig(search);
    ctl.input('Gy');
    expect(timers).toHaveLength(0);
    expect(search).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  it('gyors gépelés egyetlen kérést ad, 300 ms-os késleltetéssel', async () => {
    const search = vi.fn(async (_q: string) => parseGeocode({ features: [] }));
    const { ctl, timers } = rig(search);
    ctl.input('Győ');
    ctl.input('Győr');
    ctl.input('Győr ');
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(300);
    timers[0]!.fn();
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('Győr');
  });

  it('a lassabban érkező régi válasz nem írja felül az újat', async () => {
    const resolvers: ((p: ReturnType<typeof parseGeocode>) => void)[] = [];
    const search = vi.fn(() => new Promise<ReturnType<typeof parseGeocode>>((r) => resolvers.push(r)));
    const { ctl, timers, states } = rig(search);
    ctl.input('Győr');
    timers.shift()!.fn();
    ctl.input('Győrszentiván');
    timers.shift()!.fn();
    resolvers[1]!([{ id: 'b', name: 'új', address: '', lat: 1, lon: 1 }]);
    await flush();
    resolvers[0]!([{ id: 'a', name: 'régi', address: '', lat: 1, lon: 1 }]);
    await flush();
    const last = states.at(-1)!;
    expect(last.status === 'ok' && last.places[0]!.name).toBe('új');
  });

  it('a Geocoding-kérés: országok, nyelv, kiegészítés; a válasz feldolgozása', () => {
    const u = new URL(geocodeUrl('Győr', 'de', 'pk.x', { lat: 47.5, lon: 19.04 }));
    expect(u.searchParams.get('country')).toBe('HU,AT,SK,SI,HR,RO,IT,PL,DE,CZ');
    expect(u.searchParams.get('language')).toBe('de');
    expect(u.searchParams.get('autocomplete')).toBe('true');
    expect(u.searchParams.get('proximity')).toBe('19.04000,47.50000');
    const places = parseGeocode({
      features: [
        { id: 'x', geometry: { coordinates: [17.63, 47.68] }, properties: { mapbox_id: 'm1', name: 'Győr', place_formatted: 'Győr-Moson-Sopron, Magyarország' } },
        { geometry: null },
        { geometry: { coordinates: ['a', 'b'] }, properties: { name: 'rossz' } },
      ],
    });
    expect(places).toEqual([{ id: 'm1', name: 'Győr', address: 'Győr-Moson-Sopron, Magyarország', lat: 47.68, lon: 17.63 }]);
  });
});

describe('helyek', () => {
  const p = (i: number, lat = 47 + i) => ({ id: `p${i}`, name: `Hely ${i}`, address: '', lat, lon: 19 });

  it('az utolsó 10 cél marad, a legújabb elöl', () => {
    let list: ReturnType<typeof parseRecents> = [];
    for (let i = 0; i < 14; i++) list = addRecent(list, p(i));
    expect(list).toHaveLength(10);
    expect(list[0]!.id).toBe(placeKey(p(13)));
    expect(list.at(-1)!.id).toBe(placeKey(p(4)));
  });

  it('ugyanaz a hely nem duplázódik, hanem előre kerül', () => {
    let list = addRecent(addRecent([], p(1)), p(2));
    list = addRecent(list, { ...p(1), id: 'masik-azonosito', lat: 48.0004 });
    expect(list.map((x) => x.id)).toEqual(['48.00040,19.00000', placeKey(p(2))]);
    expect(list.map((x) => displayPlace(x).name)).toEqual(['Hely 1', 'Hely 2']);
  });

  it('AW25: tárolva csak a koordináta és a saját címke, a Mapbox-név és -cím nem; megjelenítéskor újra lekérhető', () => {
    const hit = { id: 'dXJuOm1ieHBvaTox', name: 'IKEA Budaörs', address: 'Budaörs, Pest, Magyarország', lat: 47.4613, lon: 18.9601, routable: { lat: 47.4611, lon: 18.9603 }, retrieveId: 'x', distanceM: 900 };
    const saved = setSavedPlace({ home: null, work: null, others: [] }, 'home', hit);
    const stored = JSON.stringify({ saved, recents: addRecent([], hit), other: addSavedOther(saved, { ...hit, id: 'o', lat: 47.5, label: '  Edzőterem  ' }).others });
    // AW25b: a Mapbox-azonosító sem tárolódik, a kulcs a koordináta
    for (const word of ['IKEA', 'Budaörs', 'retrieveId', 'distanceM', hit.id]) expect(stored).not.toContain(word);
    expect(saved.home).toEqual({ id: '47.46130,18.96010', name: '', address: '', lat: hit.lat, lon: hit.lon, routable: hit.routable });
    // a futás alatt a név megvan (memória), újraindítás után a koordináta, és fordított geokódolásra vár
    expect(displayPlace(saved.home!).name).toBe('IKEA Budaörs');
    forgetPlaceNames();
    const back = parseSaved(JSON.stringify(saved));
    expect(displayPlace(back.home!).name).toBe('47.4613, 18.9601');
    expect(placesNeedingNames([back.home!])).toHaveLength(1);
    // a saját címke tárolható és megjelenik
    const own = addSavedOther(back, { ...hit, id: 'o', lat: 47.5, label: '  Edzőterem  ' }).others[0]!;
    expect(own.label).toBe('Edzőterem');
    expect(displayPlace(own).name).toBe('Edzőterem');
    expect(placesNeedingNames([own])).toEqual([]);
    expect(reverseGeocodeUrl(hit, 'hu', 'pk.x')).toBe('https://api.mapbox.com/search/geocode/v6/reverse?longitude=18.960100&latitude=47.461300&language=hu&limit=1&access_token=pk.x');
  });

  it('sérült tárolt érték helyett üres lista / üres mentett helyek', () => {
    expect(parseRecents('nem json')).toEqual([]);
    expect(parseRecents('[{"x":1},null]')).toEqual([]);
    expect(parseSaved('???')).toEqual({ home: null, work: null, others: [] });
    expect(parseSaved(JSON.stringify({ home: p(1), work: 'x' }))).toMatchObject({ home: { id: '48.00000,19.00000', name: '' }, work: null });
  });

  it('AW25b: a régi, Mapbox-azonosítós tárolt hely betöltéskor koordináta-kulcsot kap; az azonos helyű elem egyszer marad', () => {
    const old = { id: 'dXJuOm1ieHBvaTox', name: 'IKEA Budaörs', address: 'Budaörs', lat: 47.4613, lon: 18.9601 };
    const saved = parseSaved(JSON.stringify({ home: old, work: null, others: [old, { ...old, id: '47.46130,18.96010', name: '' }, p(2)] }));
    expect(saved.home!.id).toBe('47.46130,18.96010');
    expect(saved.others.map((x) => x.id)).toEqual(['47.46130,18.96010', placeKey(p(2))]);
    expect(parseRecents(JSON.stringify([old, { ...old, id: 'masik' }])).map((x) => x.id)).toEqual(['47.46130,18.96010']);
    expect(JSON.stringify(saved)).not.toContain(old.id);
    expect(displayPlace(saved.home!).name).toBe('IKEA Budaörs');
  });
});

describe('költségvédelem: számláló és Directions-kliens', () => {
  const memory = (): SyncStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  const day = (d: number) => new Date(2026, 9, d, 12).getTime();

  it('a napi számláló éjfélkor nullázódik, és megmarad újraindításkor', () => {
    const store = memory();
    let now = day(28);
    const c = new RequestCounter(store, () => now);
    c.increment();
    c.increment();
    expect(c.count).toBe(2);
    expect(new RequestCounter(store, () => now).count).toBe(2);
    now = day(29);
    expect(c.count).toBe(0);
    c.increment();
    expect(c.count).toBe(1);
  });

  it('a kliens 5 mp-en belül nem hív, és minden elküldött kérést számol', async () => {
    const counter = new RequestCounter(memory(), () => day(28));
    let now = 100_000;
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => BUDAPEST_GYOR_DIRECTIONS }));
    const client = new DirectionsClient({ token: 'pk.x', lang: () => 'hu', fetch, counter, now: () => now });
    const a = { lat: 47.5, lon: 19.04 };
    const b = { lat: 47.69, lon: 17.65 };
    const routes = await client.routes(a, b, { heading: null, reason: 'plan' });
    expect(routes).toHaveLength(2);
    now += 4_000;
    await expect(client.routes(a, b, { heading: null, reason: 'reroute' })).rejects.toMatchObject({ code: 'RateLimited' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(counter.count).toBe(1);
    now += 1_000;
    await client.routes(a, b, { heading: null, reason: 'reroute' });
    expect(counter.count).toBe(2);
  });

  it('a Directions hibakódját (NoRoute) hibaként adja', async () => {
    const counter = new RequestCounter(memory());
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 'NoRoute', message: 'nincs' }) });
    const client = new DirectionsClient({ token: 'x', lang: () => 'hu', fetch, counter });
    await expect(client.routes({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, { heading: null, reason: 'plan' })).rejects.toMatchObject({ code: 'NoRoute' });
  });
});

describe('manőver-ikonok', () => {
  it('a Directions type + modifier párosa az ikon-családra képződik', () => {
    expect(maneuverIcon('turn', 'right')).toBe('right');
    expect(maneuverIcon('turn', 'sharp left')).toBe('sharp_left');
    expect(maneuverIcon('turn', 'slight right')).toBe('slight_right');
    expect(maneuverIcon('continue', 'uturn')).toBe('uturn');
    expect(maneuverIcon('roundabout', 'slight right')).toBe('roundabout_right');
    expect(maneuverIcon('rotary', 'left')).toBe('roundabout_left');
    expect(maneuverIcon('fork', 'slight left')).toBe('fork_left');
    expect(maneuverIcon('on ramp', 'straight')).toBe('straight');
    expect(maneuverIcon('arrive', null)).toBe('arrive');
    expect(maneuverIcon('whatever', 'nonsense')).toBe('straight');
  });
});

describe('alternatív útvonal a térképen: címke és kiválasztás (A8d)', () => {
  const [main, alt] = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx') as [NavRoute, NavRoute];
  const routes = [main, alt];

  it('AW18: a címke a kártyák kerekített perceiből: 42 vs 41 → „−1 perc”; „Ugyanannyi idő” csak egyenlő kerekített percnél', () => {
    expect(altDeltaText(41 * 60, 42 * 60)).toBe('−1 perc');
    expect(altDeltaText(43 * 60, 41 * 60)).toBe('+2 perc');
    // 41,5 → 42 és 41,2 → 41 perc a kártyán: 20 s különbség is „+1 perc”
    expect(altDeltaText(2490, 2470)).toBe('+1 perc');
    // mindkettő 41 perc a kártyán
    expect(altDeltaText(2470, 2440)).toBe('Ugyanannyi idő');
    setLanguage('en');
    expect(altDeltaText(180, 60)).toBe('+2 min');
  });

  it('a leágazás az alternatíva első, a kiválasztott sávján kívüli pontja; önmagától nem ágazik le', () => {
    const d = divergenceAlongM(main, alt)!;
    expect(d).toBeGreaterThan(0);
    const core = new Route(main.points, main.distanceM);
    const a = new Route(alt.points, alt.distanceM);
    expect(core.project(a.pointAt(d)).crossM).toBeGreaterThan(ROUTE_MATCH_M);
    expect(core.project(a.pointAt(Math.max(0, d - 25))).crossM).toBeLessThanOrEqual(ROUTE_MATCH_M);
    expect(divergenceAlongM(main, main)).toBeNull();
  });

  it('címke csak az alternatíván, horgony a saját szakasz legtávolabbi pontján, a kártya menetidejével számolva', () => {
    const labels = altLabels(routes, [3600, 3660], 0);
    expect(labels).toHaveLength(1);
    const l = labels[0]!;
    expect(l).toMatchObject({ routeId: alt.id, index: 1, deltaS: 60, text: '+1 perc' });
    // AW18: élesben 42 perc (0.) vs 41 perc (1.): a kiválasztott 41 perces mellett a 42 perces „+1 perc”, fordítva „−1 perc”
    expect(altLabels(routes, [2520, 2460], 1)[0]!.text).toBe('+1 perc');
    expect(altLabels(routes, [2520, 2460], 0)[0]!.text).toBe('−1 perc');
    const a = new Route(alt.points, alt.distanceM);
    const core = new Route(main.points, main.distanceM);
    // a horgony az alternatíván van, a saját szakaszán, és onnan a legmesszebb van a kiválasztottól
    expect(a.project(l.at).crossM).toBeLessThan(1);
    expect(l.own.length).toBeGreaterThan(10);
    const far = core.project(l.at).crossM;
    for (const p of l.own) expect(core.project(p).crossM).toBeLessThanOrEqual(far + 1e-6);
    expect(far).toBeGreaterThan(1000);
    // a saját szakasz minden pontja a kiválasztott sávján kívül van; a leágazás az alternatíván
    for (const p of l.own) expect(core.project(p).crossM).toBeGreaterThan(ROUTE_MATCH_M);
    expect(a.project(l.divergence).alongM).toBeCloseTo(divergenceAlongM(main, alt)!, 0);
  });

  it('kiválasztás-váltás: az érintett alternatíva lesz a kiválasztott, a címke a másikra kerül, előjelet vált', () => {
    const sel = selectRouteById(routes, 0, alt.id);
    expect(sel).toBe(1);
    const labels = altLabels(routes, [3600, 3720], sel);
    expect(labels.map((l) => [l.routeId, l.text])).toEqual([[main.id, '−2 perc']]);
    // ismeretlen azonosító (pl. elavult érintés): marad a régi
    expect(selectRouteById(routes, sel, 'nincs')).toBe(1);
    // egyetlen útvonalnál nincs címke
    expect(altLabels([main], [3600], 0)).toEqual([]);
  });
});

describe('szótár-teljesség a navigációhoz', () => {
  it('minden nav.* / map.search / settings.* új kulcs mind a 6 nyelven nem üres', () => {
    const keys = Object.keys(DICTIONARIES.hu).filter((k) => k.startsWith('nav.') || k === 'map.search' || k === 'settings.requests' || k === 'settings.voiceInstructions' || k === 'settings.group.places');
    expect(keys.length).toBeGreaterThan(40);
    for (const lang of LANGUAGES) for (const k of keys) expect((DICTIONARIES[lang] as Record<string, string>)[k]?.trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });

  it('a hangos utasítások beállítás alapból be van, és tárolódik', () => {
    expect(DEFAULT_SETTINGS.hangos_utasitasok).toBe(true);
    expect(parseSettings(JSON.stringify({ hangos_utasitasok: false })).hangos_utasitasok).toBe(false);
    expect(parseSettings('{}').hangos_utasitasok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AW12 – az első éles navi-teszt javításai
// ---------------------------------------------------------------------------

describe('AW12: „megéri”-szabály a gyorsabb útra', () => {
  const CITY_KMH = 30;
  const MOTORWAY_KMH = 120;
  const verdict = (min: number, km: number, kmh: number) => altWorth(min * 60, km * 1000, kmh).verdict;

  it('a kerülő ára az alternatíva átlagsebességéből: ≤ 40 km/h → 1,0, ≥ 110 → 0,3, között lineáris', () => {
    expect(detourCostPerKm(20)).toBe(1);
    expect(detourCostPerKm(40)).toBe(1);
    expect(detourCostPerKm(75)).toBeCloseTo(0.65, 10);
    expect(detourCostPerKm(110)).toBe(0.3);
    expect(detourCostPerKm(140)).toBe(0.3);
    expect(detourCostPerKm(NaN)).toBe(1);
    // a Directions duration / distance: 10 km 10 perc alatt = 60 km/h
    expect(routeAvgKmh(lineRoute({ lengthM: 10_000, durationS: 600 }))).toBeCloseTo(60, 10);
  });

  it('példa-táblázat, város: 1 perc / 1 km nem, 3/1 igen, 7/4 igen, 10/20 nem', () => {
    expect(verdict(1, 1, CITY_KMH)).toBe('not');
    expect(1 * 60).toBeLessThan(ALT_OFFER.minGainS); // ajánlat sem lesz belőle
    expect(verdict(3, 1, CITY_KMH)).toBe('worth');
    expect(verdict(7, 4, CITY_KMH)).toBe('worth');
    expect(verdict(10, 20, CITY_KMH)).toBe('not');
  });

  it('példa-táblázat, autópálya: 20/50 igen, 20/100 nem, 10/20 igen, 100/100 igen', () => {
    expect(verdict(20, 50, MOTORWAY_KMH)).toBe('worth');
    expect(verdict(20, 100, MOTORWAY_KMH)).toBe('not');
    expect(verdict(10, 20, MOTORWAY_KMH)).toBe('worth');
    expect(verdict(100, 100, MOTORWAY_KMH)).toBe('worth');
  });

  it('a nettó nyereség határai: net ≥ 2 → megéri, 0 < net < 2 → lehet, net ≤ 0 → nem éri meg', () => {
    expect(altWorth(120, 0, CITY_KMH)).toMatchObject({ net: 2, verdict: 'worth' });
    expect(altWorth(120, 1000, CITY_KMH)).toMatchObject({ net: 1, verdict: 'maybe' });
    expect(altWorth(120, 2000, CITY_KMH)).toMatchObject({ net: 0, verdict: 'not' });
    // rövidebb alternatíva: a megtakarított km is nyereség
    expect(altWorth(120, -1000, CITY_KMH).net).toBe(3);
  });

  /** A városi teszt-útvonal (10 km, 30 perc) és egy alternatíva a megadott többlet-távval és nyereséggel. */
  async function categoryOffer(gainMin: number, extraKm: number) {
    const route = lineRoute({ lengthM: 10_000, durationS: 1800 });
    const alt = scaleDurations(lineRoute({ lengthM: 10_000 + extraKm * 1000, durationS: 1800, id: 'alt' }), 1800 - gainMin * 60, 'alt', 0.003);
    const h = harness(route);
    h.respond([route, alt]);
    feed(h, at(route, 300, 0, T0 + 120_000));
    await flush();
    return { h, route, offer: h.session.view().offer!, voice: h.session.drainVoice().filter((v) => v.kind === 'faster').map((v) => v.text) };
  }

  it('három kategória: kártya és bemondás (megéri / lehet / nem éri meg)', async () => {
    const worth = await categoryOffer(7, 4);
    expect(worth.offer.verdict).toBe('worth');
    expect(worth.offer.title).toBe('Megéri · −7 perc, +4 km');
    // AW13: a „megéri” bemondás a lehajtó távolságával
    expect(worth.voice).toHaveLength(1);
    expect(worth.voice[0]).toMatch(/^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$/);

    const maybe = await categoryOffer(2, 1);
    expect(maybe.offer.verdict).toBe('maybe');
    expect(maybe.offer.title).toBe('Lehet · −2 perc, +1 km');
    expect(maybe.voice).toEqual(['Gyorsabb út, 2 perc, 1 kilométer kerülő, te döntesz']);

    const not = await categoryOffer(10, 20);
    expect(not.offer.verdict).toBe('not');
    expect(not.offer.title).toBe('Nem éri meg · +20 km kerülő, −10 perc');
    expect(not.voice).toEqual(['Gyorsabb út, de nem éri meg, 20 kilométer kerülő']);
  });

  it('a kártya-szöveg rövidebb alternatívánál „−km”, egyező távnál km nélkül; mind a 6 nyelven van szöveg', () => {
    expect(altOfferTitle({ gainMin: 5, extraKm: -2, verdict: 'worth' })).toBe('Megéri · −5 perc, −2 km');
    expect(altOfferTitle({ gainMin: 5, extraKm: 0.2, verdict: 'worth' })).toBe('Megéri · −5 perc');
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      for (const v of ['worth', 'maybe', 'not'] as const) {
        const w = { gainMin: 7, extraKm: 4, verdict: v };
        expect(altOfferTitle(w), `${lang} ${v}`).toMatch(/7|4/);
        expect(altOfferVoice(w), `${lang} ${v}`).not.toMatch(/[{}]/);
      }
    }
  });

  it('lejáratkor (45 s) a „megéri” elfogadódik, a „lehet” és a „nem éri meg” esetén marad a régi', async () => {
    for (const [gain, km, accepted] of [
      [7, 4, true],
      [2, 1, false],
      [10, 20, false],
    ] as const) {
      const { h, route } = await categoryOffer(gain, km);
      feed(h, at(route, 400, 0, T0 + 120_000 + NAV_CONFIG.offerTtlMs - 1));
      expect(h.session.view().offer).not.toBeNull();
      feed(h, at(route, 500, 0, T0 + 120_000 + NAV_CONFIG.offerTtlMs));
      expect(h.session.view().offer).toBeNull();
      expect(h.session.view().route.id, `${gain}/${km}`).toBe(accepted ? 'alt' : 'line');
    }
  });

  it('több jelölt közül a legnagyobb nettó nyereségű (nem a leggyorsabb)', async () => {
    const route = lineRoute({ lengthM: 10_000, durationS: 1800 });
    const fast = scaleDurations(lineRoute({ lengthM: 30_000, durationS: 1800, id: 'fast' }), 1800 - 600, 'fast', 0.003);
    const short = scaleDurations(lineRoute({ lengthM: 11_000, durationS: 1800, id: 'short' }), 1800 - 300, 'short', -0.003);
    const h = harness(route);
    h.respond([route, fast, short]);
    feed(h, at(route, 300, 0, T0 + 120_000));
    await flush();
    expect(h.session.view().offer!.route.id).toBe('short');
  });
});

describe('AW13: mérés közben a kapu utáni közeli lehajtó azonnal', () => {
  const fixture = () => {
    const [main, other] = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx') as [NavRoute, NavRoute];
    const core = new Route(main.points, main.distanceM);
    const alt = scaleDurations(other, main.durationS - 600, 'alt');
    const section = (fromM: number, toM: number): Section => ({ ...makeSection(lineRoute(), 0, 1000), start: core.pointAt(fromM), end: core.pointAt(toM), lengthM: toM - fromM });
    const fix = (alongM: number, t: number): GpsFix => ({ ...core.pointAt(alongM), timestamp: t, speed: 25, accuracy: 5, heading: null });
    const exitAlong = 1000 + firstNewManeuver(main, alt)!.distanceM;
    return { main, alt, section, fix, exitAlong };
  };

  async function measuring(endBeforeExitM: number) {
    const f = fixture();
    const h = harness(f.main);
    h.session.setData({ sections: [f.section(400, f.exitAlong - endBeforeExitM)], cameras: [], planned: [] });
    h.respond([f.main, f.alt]);
    h.session.setMeasuring(true);
    feed(h, f.fix(1000, T0 + 120_000));
    await flush();
    return { h, f };
  }

  it('a lehajtó a végkapu után 1 km-en belül → azonnal, kompakt ajánlat bemondással (mint a kapu előtti esetben)', async () => {
    const { h } = await measuring(500);
    const offer = h.session.view().offer;
    expect(offer).not.toBeNull();
    expect(offer!.compact).toBe(true);
    expect(h.session.drainVoice().filter((v) => v.kind === 'faster')).toHaveLength(1);
    // a mérés végén az ajánlat marad, teljes formában
    h.session.setMeasuring(false);
    expect(h.session.view().offer!.compact).toBe(false);
  });

  it('a határ: a végkapu után pontosan 1 km → azonnal; 1 km-nél messzebb → visszatartva, a mérés végén megjelenik', async () => {
    // 1 cm-rel a határon belül: a kapu és a lehajtó helye két vetítésből jön, a különbségük ~1e-9 m-t ingadozik
    const at = await measuring(ALT_OFFER.exitAfterGateM - 0.01);
    expect(at.h.session.view().offer?.compact).toBe(true);
    const { h } = await measuring(ALT_OFFER.exitAfterGateM + 300);
    expect(h.session.view().offer).toBeNull();
    expect(h.session.drainVoice().some((v) => v.kind === 'faster')).toBe(false);
    h.session.setMeasuring(false);
    expect(h.session.view().offer).not.toBeNull();
    expect(h.session.drainVoice().filter((v) => v.kind === 'faster')).toHaveLength(1);
  });

  it('a már látható ajánlat marad (kompakt formában), ha mérés kezdődik és a lehajtó a kapu után 1 km-en belül van', async () => {
    const f = fixture();
    const h = harness(f.main);
    h.session.setData({ sections: [f.section(400, f.exitAlong - 200)], cameras: [], planned: [] });
    h.respond([f.main, f.alt]);
    feed(h, f.fix(1000, T0 + 120_000));
    await flush();
    const id = h.session.view().offer!.id;
    h.session.setMeasuring(true);
    expect(h.session.view().offer).toMatchObject({ id, compact: true });
  });

  it('a már látható ajánlat visszatartódik, ha mérés kezdődik és a lehajtó a kaputól 1 km-nél messzebb van', async () => {
    const f = fixture();
    const h = harness(f.main);
    h.session.setData({ sections: [f.section(400, f.exitAlong - ALT_OFFER.exitAfterGateM - 300)], cameras: [], planned: [] });
    h.respond([f.main, f.alt]);
    feed(h, f.fix(1000, T0 + 120_000));
    await flush();
    expect(h.session.view().offer).not.toBeNull();
    h.session.setMeasuring(true);
    expect(h.session.view().offer).toBeNull();
    h.session.setMeasuring(false);
    expect(h.session.view().offer).not.toBeNull();
  });

  it('a munkamenet „megéri” bemondása a lehajtó távolságával (a Budapest→Győr fixtúrán)', async () => {
    const f = fixture();
    const h = harness(f.main);
    h.session.setData({ sections: [], cameras: [], planned: [] });
    h.respond([f.main, f.alt]);
    feed(h, f.fix(1000, T0 + 120_000));
    await flush();
    const offer = h.session.view().offer!;
    expect(offer.verdict).toBe('worth');
    const [voice] = h.session.drainVoice().filter((v) => v.kind === 'faster');
    expect(voice!.text).toMatch(/^Gyorsabb út, \d+ perc megtakarítás, lehajtó \d+,\d kilométernél$/);
    expect(voice!.text).toContain(offer.exitKm);
  });

  it('timeLeft (a fogyó csík): 1-ről a lejáratig fogy', async () => {
    const f = fixture();
    const h = harness(f.main);
    h.session.setData({ sections: [], cameras: [], planned: [] });
    h.respond([f.main, f.alt]);
    feed(h, f.fix(1000, T0 + 120_000));
    await flush();
    expect(h.session.view().offer!.timeLeft).toBe(1);
    feed(h, f.fix(1100, T0 + 120_000 + NAV_CONFIG.offerTtlMs / 3));
    expect(h.session.view().offer!.timeLeft).toBeCloseTo(2 / 3, 5);
  });
});

describe('AW13: „megéri” bemondás a lehajtóval', () => {
  it('„Gyorsabb út, {perc} perc megtakarítás, lehajtó {km} kilométernél”; ismeretlen lehajtónál a lehajtó nélkül; 6 nyelven', () => {
    const w = { gainMin: 7, extraKm: 4, verdict: 'worth' as const };
    expect(altOfferVoice(w, '5,2')).toBe('Gyorsabb út, 7 perc megtakarítás, lehajtó 5,2 kilométernél');
    expect(altOfferVoice(w)).toBe('Gyorsabb út, 7 perc megtakarítás');
    // a „lehet” és a „nem éri meg” szövege nem változik
    expect(altOfferVoice({ ...w, verdict: 'maybe' }, '5,2')).toBe('Gyorsabb út, 7 perc, 4 kilométer kerülő, te döntesz');
    expect(altOfferVoice({ ...w, verdict: 'not' }, '5,2')).toBe('Gyorsabb út, de nem éri meg, 4 kilométer kerülő');
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      const text = altOfferVoice(w, '5,2');
      expect(text, lang).toMatch(/7/);
      expect(text, lang).toContain('5,2');
      expect(text, lang).not.toMatch(/[{}]/);
    }
  });
});

describe('AW13: kétsoros kompakt ajánlat', () => {
  it('AW17: „Kijárat 56 · 2,5 km · −7 perc gyorsabb”; név nélkül „Lehajtó 2,5 km-nél · −7 perc gyorsabb”; ismeretlen lehajtónál a cím', () => {
    const o = { title: 'Megéri · −7 perc, +4 km', gainS: 7 * 60 + 10, exitAlongM: 12_000, exitName: 'Kijárat 56', exitKm: '2,5' };
    expect(altOfferCompactLines(o)).toEqual(['Kijárat 56', '2,5 km · −7 perc gyorsabb']);
    expect(altOfferCompactText(o)).toBe('Kijárat 56 · 2,5 km · −7 perc gyorsabb');
    expect(altOfferCompactText({ ...o, exitName: null })).toBe('Lehajtó 2,5 km-nél · −7 perc gyorsabb');
    expect(altOfferCompactText({ ...o, exitName: '' })).toBe('Lehajtó 2,5 km-nél · −7 perc gyorsabb');
    expect(altOfferCompactText({ ...o, exitAlongM: null })).toBe('Megéri · −7 perc, +4 km');
    expect(altOfferCompactLines({ ...o, gainS: 20 })[1]).toBe('2,5 km · −1 perc gyorsabb');
    // a „gyorsabb” szó mind a 6 nyelven ott van
    const faster: Record<string, string> = { hu: 'gyorsabb', en: 'faster', de: 'schneller', sk: 'rýchlejšie', cs: 'rychleji', pl: 'szybciej' };
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      expect(altOfferCompactText(o), lang).toMatch(new RegExp(`^Kijárat 56 · 2,5 km · −?7 \\S+ ?${faster[lang]}$`));
      expect(altOfferCompactText({ ...o, exitName: null }), lang).toContain(faster[lang]!);
    }
  });
});

describe('AW12: újratervezés, kamera, „Utána”, érkezés, követő zoom, mentett címek', () => {
  it('az „Újratervezés” a letéréskor szól (a kiírással együtt), az új útvonal érkezése előtt, és egyszer', async () => {
    const route = lineRoute();
    const h = harness(route);
    feed(h, at(route, 2000, 0, T0));
    h.session.drainVoice();
    const v1 = feed(h, at(route, 2050, 300, T0 + 1000));
    expect(v1.offRoute).toBe(true);
    expect(h.session.drainVoice().map((v) => v.kind)).toEqual(['reroute']);
    expect(h.calls).toHaveLength(0); // még nincs új útvonal-kérés
    for (let s = 2; s <= 7; s++) feed(h, at(route, 2050, 300, T0 + s * 1000));
    expect(h.calls.map((c) => c.reason)).toEqual(['reroute']);
    await flush();
    expect(h.session.drainVoice().filter((v) => v.kind === 'reroute')).toHaveLength(0);
  });

  it('kamera-közeledés: max(250 m, 10 s × sebesség) – 60 km/h → 250 m, 130 km/h → 361 m; elhaladás után eltűnik', () => {
    expect(cameraAlertM(60 / 3.6)).toBe(250);
    expect(cameraAlertM(130 / 3.6)).toBeCloseTo(361.1, 1);
    expect(cameraAlertM(null)).toBe(CAMERA_ALERT.minM);
    const route = lineRoute();
    const cam = at(route, 5000, 10);
    const camera: FixedCamera = { id: 'cam', country: 'HU', type: 'speed', lat: cam.lat, lon: cam.lon, headingDeg: null, road: 'M1', speedLimitKmh: 50, source: 'teszt', sourceUrl: '', sourceDate: '2026-10', verified: true };
    const h = harness(route);
    h.session.setData({ sections: [], cameras: [camera], planned: [] });
    const v60 = 60 / 3.6;
    expect(feed(h, at(route, 4700, 0, T0, { speed: v60 })).cameraNear).toBeNull();
    expect(feed(h, at(route, 4760, 0, T0 + 1000, { speed: v60 })).cameraNear?.item.id).toBe('cam');
    // gyorsan már 360 m-ről
    expect(feed(h, at(route, 4650, 0, T0 + 2000, { speed: 130 / 3.6 })).cameraNear?.distanceM).toBeCloseTo(350, 0);
    expect(feed(h, at(route, 5010, 0, T0 + 3000, { speed: v60 })).cameraNear).toBeNull();
    // a távoli jelzés (kis sor) közben megmarad
    expect(feed(h, at(route, 3500, 0, T0 + 4000, { speed: v60 })).upcoming?.item.kind).toBe('camera');
  });

  it('az „Utána” sor: manőver-ikon + utcanév, név nélkül rövid manőver-szó – nem a teljes Directions-mondat', () => {
    const step = (instruction: string, bannerText: string, type = 'turn', modifier = 'right'): NavRoute['steps'][number] => ({
      index: 0,
      distanceM: 100,
      durationS: 10,
      startM: 0,
      durationTypicalS: null,
      roadClass: null,
      name: '',
      endManeuver: { type, modifier, instruction, location: ORIGIN },
      banners: [{ distanceAlongM: 100, primary: { text: bannerText, type, modifier }, secondary: null, sub: null }],
      voice: [],
    });
    const after = (name: string) => ({ ...step('', ''), name });
    // a szalag a mondat (név nélküli manőver): az utcanév kerül a helyére, ha van; különben a manőver-szó
    expect(thenText(step('Forduljon jobbra, hogy a bekötőútra hajtson.', 'Forduljon jobbra, hogy a bekötőútra hajtson'), after('Fő utca'), 'right')).toBe('Fő utca');
    expect(thenText(step('Forduljon jobbra, hogy ráhajtson a bekötőútra.', 'Forduljon jobbra, hogy a bekötőútra'), after(''), 'right')).toBe('Jobbra');
    expect(thenText(step('Forduljon jobbra.', 'Forduljon jobbra'), undefined, 'right')).toBe('Jobbra');
    // valódi utcanév / útszám a szalagon: az marad
    expect(thenText(step('Forduljon balra az 1 irányába.', '1'), after(''), 'left')).toBe('1');
    expect(thenText(step('Forduljon jobbra az Abádi utcára.', 'Abádi utca'), after('Abádi utca'), 'right')).toBe('Abádi utca');
    expect(thenText(step('Megérkezett.', 'Megérkezett', 'arrive', ''), undefined, 'arrive')).toBe('Cél');
    // a fixtúrán: egyik „Utána” sem a teljes mondat
    const [main] = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx') as [NavRoute];
    const h = harness(main);
    const core = new Route(main.points, main.distanceM);
    for (const s of main.steps.slice(0, -2)) {
      const v = feed(h, { ...core.pointAt(s.startM + 1), timestamp: T0, speed: 10, accuracy: 5, heading: null });
      if (v.then) expect(v.then.text, `${s.index}`).not.toMatch(/^(Forduljon|Tartson|Hajtson|Megérkezett)/);
    }
  });

  /** Az Építész utca 11 valódi Directions-válaszának vége (2026-10-29): a cél a sarki mellékutcára (Abádi utca) illesztve. */
  const epiteszUtca = (lastStepM = 8.039) => ({
    code: 'Ok',
    routes: [
      {
        distance: 300 + 162.746 + lastStepM,
        duration: 80,
        geometry: { coordinates: [[19.0337, 47.4482], [19.037655, 47.448162], [19.039807, 47.448023], [19.039796, 47.447951]] },
        legs: [
          {
            annotation: { maxspeed: [], congestion: [], duration: [] },
            steps: [
              { distance: 300, duration: 40, name: 'Bártfai utca', maneuver: { type: 'depart', location: [19.0337, 47.4482], instruction: 'Hajtson keletre.' }, bannerInstructions: [{ distanceAlongGeometry: 300, primary: { text: 'Építész utca', type: 'turn', modifier: 'left' } }], voiceInstructions: [] },
              {
                distance: 162.746,
                duration: 35,
                name: 'Építész utca',
                maneuver: { type: 'turn', modifier: 'left', location: [19.037655, 47.448162], instruction: 'Forduljon balra az Építész utcára.' },
                bannerInstructions: [{ distanceAlongGeometry: 162.746, primary: { text: 'Abádi utca', type: 'turn', modifier: 'right' } }],
                voiceInstructions: [
                  { distanceAlongGeometry: 146.079, announcement: '200 méter múlva, Forduljon jobbra az Abádi utcára.' },
                  { distanceAlongGeometry: 61.75, announcement: 'Forduljon jobbra az Abádi utcára. Utána Az Ön úti célja balra lesz.' },
                ],
              },
              {
                distance: lastStepM,
                duration: 5,
                name: 'Abádi utca',
                maneuver: { type: 'turn', modifier: 'right', location: [19.039807, 47.448023], instruction: 'Forduljon jobbra az Abádi utcára.' },
                bannerInstructions: [{ distanceAlongGeometry: lastStepM, primary: { text: 'Az úti célja balra van', type: 'arrive', modifier: 'left' } }],
                voiceInstructions: [{ distanceAlongGeometry: 4.039, announcement: 'Az Ön úti célja balra van.' }],
              },
              { distance: 0, duration: 0, name: 'Abádi utca', maneuver: { type: 'arrive', modifier: 'left', location: [19.039796, 47.447951], instruction: 'Az úti célja balra van.' } },
            ],
          },
        ],
      },
    ],
  });

  it('érkezés (Építész utca 11): az érkezési küszöbnél rövidebb utolsó kanyar beolvad az érkezésbe', () => {
    const [r] = parseDirections(epiteszUtca(), 'ep') as [NavRoute];
    // a „Forduljon jobbra az Abádi utcára” (8 m) nem önálló manőver: az Építész utca lépés vége már az érkezés
    expect(r.steps.map((s) => s.endManeuver.type)).toEqual(['turn', 'arrive', 'arrive']);
    const last = r.steps[1]!;
    expect(last.name).toBe('Építész utca');
    expect(last.distanceM).toBeCloseTo(162.746 + 8.039, 6);
    expect(last.banners[0]!.primary).toMatchObject({ type: 'arrive', text: 'Az úti célja balra van' });
    expect(last.voice.map((v) => v.text)).toEqual(['Az Ön úti célja balra van.']);
    expect(last.voice[0]!.distanceAlongM).toBeGreaterThan(NAV_CONFIG.arriveM);
    expect(r.steps.map((s) => s.index)).toEqual([0, 1, 2]);
    // a lépések összhossza továbbra is az útvonal hossza
    expect(r.steps.reduce((a, s) => a + s.distanceM, 0)).toBeCloseTo(r.distanceM, 6);
    // a kanyar előtt a felső kártya már az érkezést mutatja, nem a mellékutcát
    const h = harness(r);
    const core = new Route(r.points, r.distanceM);
    const v = feed(h, { ...core.pointAt(320), timestamp: T0, speed: 8, accuracy: 5, heading: null });
    expect(v.next.icon).toBe('arrive');
    expect(v.then).toBeNull();
    // a küszöbnél hosszabb utolsó lépés valódi manőver: marad
    const [long] = parseDirections(epiteszUtca(60), 'ep') as [NavRoute];
    expect(long.steps.map((s) => s.endManeuver.type)).toEqual(['turn', 'turn', 'arrive', 'arrive']);
    const steps = structuredClone(long.steps);
    absorbArrivalStub(steps, 30);
    expect(steps).toHaveLength(4);
  });

  it('érkezés: a tervezés a cím útra illesztett pontjára (routable point) megy, a jelölő a címen marad', async () => {
    const places = parseGeocode({
      features: [
        {
          geometry: { coordinates: [19.039894, 47.447944] },
          properties: { mapbox_id: 'ep11', name: 'Építész utca 11', place_formatted: 'Budapest, 1116', coordinates: { routable_points: [{ name: 'default', latitude: 47.448016, longitude: 19.039905 }] } },
        },
        { geometry: { coordinates: [19.04, 47.45] }, properties: { name: 'Építész utca', coordinates: {} } },
      ],
    });
    expect(places[0]).toMatchObject({ lat: 47.447944, lon: 19.039894, routable: { lat: 47.448016, lon: 19.039905 } });
    expect(routeTarget(places[0]!)).toEqual({ lat: 47.448016, lon: 19.039905 });
    expect(places[1]!.routable).toBeUndefined();
    expect(routeTarget(places[1]!)).toEqual({ lat: 47.45, lon: 19.04 });
    // a tárolt utolsó célok és mentett helyek megtartják
    expect(parseRecents(JSON.stringify(addRecent([], places[0]!)))[0]!.routable).toEqual({ lat: 47.448016, lon: 19.039905 });
    // az újratervezés is oda tervez
    const route = lineRoute();
    const routable = { lat: 47.6, lon: 19.2 };
    const h = harness(route, { routable });
    for (let s = 0; s <= 6; s++) feed(h, at(route, 2000, 300, T0 + s * 1000));
    await flush();
    expect(h.calls[0]!.to).toEqual(routable);
    expect(h.session.view().destination).toMatchObject({ lat: route.points.at(-1)!.lat });
  });

  it('követő zoom és a jelölő helye: < 30 km/h 17,2, 90 km/h 15,6, 130 km/h 14,8, között lineáris', () => {
    expect(followZoom(0)).toBe(17.2);
    expect(followZoom(30)).toBe(17.2);
    expect(followZoom(50)).toBeCloseTo(16.8, 10);
    expect(followZoom(70)).toBeCloseTo(16.2, 10);
    expect(followZoom(90)).toBeCloseTo(15.6, 10);
    expect(followZoom(130)).toBe(14.8);
    expect(followZoom(180)).toBe(14.8);
    expect(followZoom(NaN)).toBe(17.2);
    // a jelölő a legfelső alsó kártya fölött, a képernyő alsó részén, minden állapotban ugyanígy
    expect(followFocusY(800, 932)).toBeCloseTo((800 - 112) / 932, 10);
    expect(followFocusY(930, 932)).toBe(0.8);
    expect(followFocusY(100, 932)).toBe(0.18);
  });

  it('mentett címek: Haza, Munka, továbbiak – chip-sorrend, nem duplázódik, törölhető, tárolódik', () => {
    const p = (i: number, name = `Hely ${i}`) => ({ id: `p${i}`, name, address: '', lat: 47 + i, lon: 19 });
    let saved: SavedPlaces = { home: p(1, 'Otthon utca'), work: null, others: [] };
    saved = addSavedOther(saved, p(2, 'Edzőterem'));
    saved = addSavedOther(saved, p(3, 'Nagymama'));
    expect(addSavedOther(saved, { ...p(2), id: 'masik' })).toBe(saved);
    expect(savedChips(saved).map((c) => [c.icon, c.label])).toEqual([
      ['home', 'Haza'],
      ['pin', 'Edzőterem'],
      ['pin', 'Nagymama'],
    ]);
    expect(parseSaved(JSON.stringify(saved)).others.map((x) => displayPlace(x).name)).toEqual(['Edzőterem', 'Nagymama']);
    expect(removeSavedOther(saved, saved.others[0]!.id).others.map((x) => x.id)).toEqual([placeKey(p(3))]);
  });
});

describe('AOS13: a felső lépés-kártya nem kerülhet az alsó kártya-csoport alá', () => {
  it('mérés közben mindig sáv; egyébként sáv, ha a teljes kártya (+ térköz) az alsó csoport teteje alá érne; méretlenül kártya', () => {
    const gap = 8;
    // a mérés utáni eredménykártya a 390 × 844-es nézetben (AOS13): a kártya alja 322, a „Szakasz vége” teteje 237
    expect(navStepStrip({ measuring: false, cardBottom: 322, bottomTop: 237, gap })).toBe(true);
    // navigációs alsó sáv (nincs szakasz): bőven elfér
    expect(navStepStrip({ measuring: false, cardBottom: 322, bottomTop: 740, gap })).toBe(false);
    // a határ: pontosan a térköznyi rés még elfér
    expect(navStepStrip({ measuring: false, cardBottom: 322, bottomTop: 330, gap })).toBe(false);
    expect(navStepStrip({ measuring: false, cardBottom: 322.5, bottomTop: 330, gap })).toBe(true);
    // mérés közben a mérési adatoktól függetlenül sáv
    expect(navStepStrip({ measuring: true, cardBottom: 322, bottomTop: 740, gap })).toBe(true);
    expect(navStepStrip({ measuring: true, cardBottom: null, bottomTop: null, gap })).toBe(true);
    // az első elrendezés előtt a teljes kártya marad
    expect(navStepStrip({ measuring: false, cardBottom: null, bottomTop: 237, gap })).toBe(false);
    expect(navStepStrip({ measuring: false, cardBottom: 322, bottomTop: null, gap })).toBe(false);
  });

  it('navigáció közben a mérés eredménye kompakt; navigáció nélkül és más fázisban a nagy kártya marad', () => {
    expect(navResultCompact('befejezve', true)).toBe(true);
    expect(navResultCompact('befejezve', false)).toBe(false);
    for (const phase of ['nincs_szakasz', 'kozeledik', 'meres', 'kezi', 'megszakadt'] as const) {
      expect(navResultCompact(phase, true), phase).toBe(false);
    }
  });
});

describe('AW15: kézi átlagmérés navigáció közben', () => {
  it('a kézi mérés eredménye navigáció közben kompakt, navigáció nélkül nagy', () => {
    expect(navResultCompact('kezi_eredmeny', true)).toBe(true);
    expect(navResultCompact('kezi_eredmeny', false)).toBe(false);
  });

  it('a zsugorított kártya: navigáció nélkül nincs; induláskor teljes kártya, 5 s után zsugorított; bökésre ki, újabb bökésre vagy 5 s után vissza', () => {
    expect(MANUAL_PILL.collapseAfterMs).toBe(5000);
    expect(manualPillTick(null, false, false, 0)).toBeNull();
    let s = manualPillTick(null, true, false, 1000)!;
    expect(s.collapsed).toBe(false);
    s = manualPillTick(s, true, false, 5999)!;
    expect(s.collapsed).toBe(false);
    s = manualPillTick(s, true, false, 6000)!;
    expect(s.collapsed).toBe(true);
    // bökésre teljes kártya, az 5 s újraindul
    s = manualPillTap(s, 10_000);
    expect(s.collapsed).toBe(false);
    expect(manualPillTick(s, true, false, 14_999)!.collapsed).toBe(false);
    expect(manualPillTick(s, true, false, 15_000)!.collapsed).toBe(true);
    // újabb bökésre azonnal vissza
    expect(manualPillTap(s, 11_000).collapsed).toBe(true);
    // a navigáció vége / a mérés vége: nincs zsugorítás (a nagy kártya, ill. az eredmény)
    expect(manualPillTick(s, false, false, 11_000)).toBeNull();
    // változatlan állapotnál ugyanaz az objektum (a nézet nem renderel feleslegesen)
    expect(manualPillTick(s, true, false, 11_000)).toBe(s);
  });

  it('a zsugorított kártya: magától összemegy, ha a navigációnak hely kell (manőver < 500 m, ajánlat, közeli kamera)', () => {
    expect(navNeedsSpace({ maneuverM: 499, offer: false, cameraNear: false })).toBe(true);
    expect(navNeedsSpace({ maneuverM: 500, offer: false, cameraNear: false })).toBe(false);
    expect(navNeedsSpace({ maneuverM: null, offer: false, cameraNear: false })).toBe(false);
    expect(navNeedsSpace({ maneuverM: 3000, offer: true, cameraNear: false })).toBe(true);
    expect(navNeedsSpace({ maneuverM: 3000, offer: false, cameraNear: true })).toBe(true);
    // a hely-igény a nyitott (felhasználó által kinyitott) kártyát azonnal összecsukja
    let s = manualPillTick(null, true, false, 0)!;
    s = manualPillTick(s, true, false, 5000)!; // 5 s: zsugorított
    s = manualPillTap(s, 6000); // a felhasználó kinyitja
    expect(manualPillTick(s, true, false, 7000)!.collapsed).toBe(false);
    expect(manualPillTick(s, true, true, 7000)!.collapsed).toBe(true); // felfutó él → azonnal
    // ha a hely-igény már fennáll, miközben kinyitják: 5 s-ig nyitva marad
    let t = manualPillTick(null, true, true, 0)!;
    t = manualPillTick(t, true, true, 3000)!; // 3 s: összement
    t = manualPillTap(t, 4000);
    expect(manualPillTick(t, true, true, 8999)!.collapsed).toBe(false);
    expect(manualPillTick(t, true, true, 9000)!.collapsed).toBe(true);
  });

  it('indítás után az első 5 s-ban nyitva marad hely-igény mellett is, de 3 s után összemegy (az indítástól)', () => {
    expect(MANUAL_PILL.startSpaceCollapseMs).toBe(3000);
    // indításkor már fennálló hely-igény: 0–2,999 s nyitva, 3 s-tól zsugorított
    let s = manualPillTick(null, true, true, 10_000)!;
    expect(s.collapsed).toBe(false);
    expect(manualPillTick(s, true, true, 12_999)!.collapsed).toBe(false);
    expect(manualPillTick(s, true, true, 13_000)!.collapsed).toBe(true);
    // a hely-igény 1 s-nál jelenik meg: nem csuk azonnal, 3 s-nál igen
    s = manualPillTick(null, true, false, 0)!;
    s = manualPillTick(s, true, true, 1000)!;
    expect(s.collapsed).toBe(false);
    expect(manualPillTick(s, true, true, 3000)!.collapsed).toBe(true);
    // 4 s-nál jelenik meg: már elmúlt a 3 s → azonnal zsugorított
    s = manualPillTick(null, true, false, 0)!;
    expect(manualPillTick(s, true, true, 4000)!.collapsed).toBe(true);
    // hely-igény nélkül marad az 5 s
    s = manualPillTick(null, true, false, 0)!;
    expect(manualPillTick(s, true, false, 4999)!.collapsed).toBe(false);
    expect(manualPillTick(s, true, false, 5000)!.collapsed).toBe(true);
  });

});

describe('AW17: elrendezés, „Utána” 5 km-en belül, tábla és mérés, Beállítások', () => {
  it('az „Utána” sor csak akkor, ha a következő manőver 5 km-en belül van', () => {
    const [main] = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx') as [NavRoute];
    const core = new Route(main.points, main.distanceM);
    // egy 5 km-nél hosszabb lépés, amely után még jön manőver (az autópálya-szakasz)
    const step = main.steps.find((s, i) => s.distanceM > NAV_CONFIG.thenWithinM + 1000 && i + 2 < main.steps.length)!;
    expect(step).toBeDefined();
    const fix = (alongM: number, t: number): GpsFix => ({ ...core.pointAt(alongM), timestamp: t, speed: 25, accuracy: 5, heading: null });
    const h = harness(main);
    const endM = step.startM + step.distanceM;
    const far = feed(h, fix(endM - NAV_CONFIG.thenWithinM - 500, T0));
    expect(far.next.distanceM).toBeGreaterThan(NAV_CONFIG.thenWithinM);
    expect(far.then).toBeNull();
    const near = feed(h, fix(endM - NAV_CONFIG.thenWithinM + 500, T0 + 1000));
    expect(near.next.distanceM).toBeLessThanOrEqual(NAV_CONFIG.thenWithinM);
    expect(near.then).not.toBeNull();
  });

  it('alsó sáv: mérés közben nincs benne sebesség (a mérőkártya „most” mezője mutatja), máskor van', () => {
    expect(navBottomShowsSpeed('meres')).toBe(false);
    for (const phase of ['nincs_szakasz', 'kozeledik', 'befejezve', 'megszakadt', 'kezi', 'kezi_eredmeny'] as const) expect(navBottomShowsSpeed(phase), phase).toBe(true);
  });

  it('alsó sáv km/h: piros, ha a kijelzett sebesség a bal alsó tábla limitje fölött van; limit nélkül soha', () => {
    expect(navSpeedOver(111, 110)).toBe(true);
    expect(navSpeedOver(110.4, 110)).toBe(false);
    expect(navSpeedOver(110.5, 110)).toBe(true);
    expect(navSpeedOver(110, 110)).toBe(false);
    expect(navSpeedOver(150, null)).toBe(false);
    expect(navSpeedOver(null, 50)).toBe(false);
  });

  it('egysoros kártyánál nincs külön „Lassíts” sáv – a max érték a kártyában; teljes kártyánál a sáv visszajön', () => {
    expect(slowDownBarShown(navMeterCompact('meres', true))).toBe(false);
    expect(slowDownBarShown(navMeterCompact('meres', false))).toBe(true);
    // a 137 / 130 / 108-as példa: „lassíts”, max 115
    expect(compactMeterBarText(meterBar('lassits', { kind: 'ok', maxKmh: 115.28 }), 'kmh')).toBe('max 115');
    expect(compactMeterBarText(meterBar('tul_gyors', { kind: 'ok', maxKmh: 103.4 }), 'kmh')).toBe('max 103');
    expect(compactMeterBarText(meterBar('tul_gyors', { kind: 'nem_lehetseges', maxKmh: 40 }), 'kmh')).toBe('nem hozható');
    expect(compactMeterBarText(meterBar('jo', { kind: 'ok', maxKmh: 140 }), 'kmh')).toBeNull();
    expect(compactMeterBarText(meterBar('tul_gyors', { kind: 'ok', maxKmh: 160.934 }), 'mph')).toBe('max 100');
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      expect(compactMeterBarText({ kind: 'max', maxKmh: 115 }, 'kmh'), lang).toMatch(/115/);
      expect(compactMeterBarText({ kind: 'nem_hozhato' }, 'kmh'), lang).toBeTruthy();
    }
  });

  it('mérés + ajánlat egyszerre: a mérőkártya egysoros; ajánlat nélkül vagy mérésen kívül teljes', () => {
    expect(navMeterCompact('meres', true)).toBe(true);
    expect(navMeterCompact('meres', false)).toBe(false);
    expect(navMeterCompact('kozeledik', true)).toBe(false);
    expect(navMeterCompact('befejezve', true)).toBe(false);
  });

  it('szakaszon belüli alacsonyabb Mapbox-tábla (110) nem változtatja a mérés határát (130) – csak a bal alsó tábla követi', () => {
    const route = lineRoute({ lengthM: 10_000, durationS: 300, limit: 110 });
    const section = { ...makeSection(route, 1000, 9000), speedLimitKmh: 130 };
    const h = harness(route);
    h.session.setData({ sections: [section], cameras: [], planned: [] });
    const measure = new TrackingSession([section], { now: () => h.clock.t });
    const v120 = 120 / 3.6;
    let nav = feed(h, at(route, 0, 0, T0, { speed: v120 }));
    let meter = measure.onFix(at(route, 0, 0, T0, { speed: v120 }));
    for (let s = 1; s <= 150; s++) {
      const fix = at(route, s * v120, 0, T0 + s * 1000, { speed: v120 });
      nav = feed(h, fix);
      meter = measure.onFix(fix);
    }
    // a navigáció táblája a Mapbox-limit (110), a mérés a szakasz határával (130) számol
    expect(nav.limitKmh).toBe(110);
    expect(nav.enforcement.find((x) => x.kind === 'section')?.limitKmh).toBe(130);
    expect(meter.phase).toBe('meres');
    expect(meter.section!.speedLimitKmh).toBe(130);
    expect(meter.live!.averageKmh!).toBeCloseTo(120, 0);
    expect(meter.status).toBe('jo');
    // 120 > 110: az alsó sáv piros (csak a tábla követi), a mérés állapota jó (130 alatt)
    expect(navSpeedOver(meter.currentKmh, nav.limitKmh)).toBe(true);
  });

  it('Beállítások: a hang elérhetősége zárójelben a „Hangos utasítások” leírásának végén', () => {
    expect(voiceInstructionsHint('ok')).toBe('Fordulók, szakaszellenőrzés és „túl gyors” bemondása (Van hang ehhez a nyelvhez)');
    expect(voiceInstructionsHint('missing')).toMatch(/^Fordulók, .* \(Ehhez a nyelvhez nincs hang az eszközön – .*\)$/);
    expect(voiceInstructionsHint('unsupported')).toMatch(/\(A böngésző nem tud beszélni\)$/);
    expect(DICTIONARIES.hu).not.toHaveProperty('settings.voice');
    setLanguage('en');
    expect(voiceInstructionsHint('ok')).toBe('Announces turns, section checks and “too fast” warnings (A voice is available for this language)');
  });
});

describe('AW17: az útvonalválasztó „+N perc” címkéjének helye (képernyő-pixelben)', () => {
  const VP = { w: 390, h: 844 };
  const LABEL = { w: 72, h: 30 };
  const dist = (p: Px, line: readonly Px[]) => {
    let d = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
      d = Math.min(d, Math.hypot(p.x - (a.x + u * (b.x - a.x)), p.y - (a.y + u * (b.y - a.y))));
    }
    return d;
  };
  const boxDist = (p: Px, b: { x: number; y: number; w: number; h: number }) =>
    Math.hypot(p.x - Math.max(b.x, Math.min(p.x, b.x + b.w)), p.y - Math.max(b.y, Math.min(p.y, b.y + b.h)));

  it('szintetikus: a horgony a legtávolabbi pont, a címke tőle elfelé (fölé), vonalat nem takar', () => {
    const base = [{ x: 0, y: 500 }, { x: 400, y: 500 }];
    const alt = [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 300 }, { x: 200, y: 280 }, { x: 300, y: 300 }, { x: 300, y: 500 }, { x: 400, y: 500 }];
    const own = [{ x: 100, y: 400 }, { x: 100, y: 300 }, { x: 150, y: 290 }, { x: 200, y: 280 }, { x: 250, y: 290 }, { x: 300, y: 300 }, { x: 300, y: 400 }];
    const p = placeAltLabel({ own, base, alt, divergence: { x: 100, y: 500 }, label: { w: 60, h: 28 }, viewport: { w: 400, h: 800 } })!;
    expect(p.anchor).toEqual({ x: 200, y: 280 });
    expect(p.side).toBe('above');
    expect(p.box).toEqual({ x: 170, y: 280 - ALT_LABEL_PLACE.gapPx - 28, w: 60, h: 28 });
  });

  it('szintetikus: ha a legtávolabbi pont mellett minden oldal a célt takarná, a következő legtávolabbi a horgony', () => {
    // a kiválasztott a (300,500)-nál ér véget (cél); az alternatíva legtávolabbi pontja a cél-jelölőn van (30 px-rel
    // fölötte): bármelyik oldalra kerülne, a jelölőt takarná
    const base = [{ x: 0, y: 500 }, { x: 300, y: 500 }];
    const alt = [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 150, y: 515 }, { x: 300, y: 470 }, { x: 300, y: 500 }];
    const own = [{ x: 150, y: 515 }, { x: 300, y: 470 }];
    const p = placeAltLabel({ own, base, alt, divergence: { x: 100, y: 500 }, label: { w: 60, h: 28 }, viewport: { w: 400, h: 800 } })!;
    expect(p.anchor).toEqual({ x: 150, y: 515 });
    expect(boxDist({ x: 300, y: 500 }, p.box)).toBeGreaterThanOrEqual(ALT_LABEL_PLACE.divergenceClearPx);
  });

  it('szintetikus: a képernyő szélén nem lóg ki, ha máshová kifér; ha sehová, rálóghat', () => {
    const shift = (pts: Px[]) => pts.map((q) => ({ x: q.x, y: q.y - 260 }));
    const base = shift([{ x: 0, y: 500 }, { x: 400, y: 500 }]);
    const alt = shift([{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 300 }, { x: 200, y: 280 }, { x: 300, y: 300 }, { x: 300, y: 500 }, { x: 400, y: 500 }]);
    const own = shift([{ x: 100, y: 300 }, { x: 200, y: 280 }, { x: 300, y: 300 }]);
    const input = { own, base, alt, divergence: { x: 100, y: 240 }, label: { w: 60, h: 28 }, viewport: { w: 400, h: 800 } };
    const p = placeAltLabel(input)!;
    expect(p.anchor).toEqual({ x: 200, y: 20 });
    expect(p.side).not.toBe('above');
    expect(p.box.y).toBeGreaterThanOrEqual(0);
    // apró nézet: sehová sem fér ki – akkor is van hely (rálóg)
    expect(placeAltLabel({ ...input, viewport: { w: 40, h: 40 } })).not.toBeNull();
    expect(placeAltLabel({ ...input, own: [] })).toBeNull();
  });

  for (const selected of [0, 1] as const) {
    it(`Budapest→Győr, ${selected === 0 ? 'M19 kiválasztva, címke a Győr-belvárosi alternatíván' : 'Győr-belváros kiválasztva, címke az M19-es alternatíván'}: nem takarja a leágazást és a célt, a saját szakasz legtávolabbi része mellett`, () => {
      const routes = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx') as [NavRoute, NavRoute];
      const l = altLabels(routes, routes.map((r) => r.durationS), selected)[0]!;
      const all = routes.flatMap((r) => r.points);
      const lat = all.map((p) => p.lat);
      const lon = all.map((p) => p.lon);
      const center = { lat: (Math.min(...lat) + Math.max(...lat)) / 2, lon: (Math.min(...lon) + Math.max(...lon)) / 2 };
      // a nézet, mint az útvonalválasztóban: felül 120, alul 400 (a kártya), oldalt 36 px; a címke a kártya fölötti
      // részben számol (a webes adapter is a `padBottom`-mal csökkentett magassággal)
      const PAD = { top: 120, bottom: 400, side: 36 };
      const area = { w: VP.w, h: VP.h - PAD.bottom };
      const shiftY = (PAD.top - PAD.bottom) / 2;
      const project = (p: LatLon, z: number) => {
        const q = mercatorScreen(p, { center, zoom: z }, VP);
        return { x: q.x, y: q.y + shiftY };
      };
      const fits = (z: number) =>
        all.every((p) => {
          const q = project(p, z);
          return q.x >= PAD.side && q.x <= VP.w - PAD.side && q.y >= PAD.top && q.y <= VP.h - PAD.bottom;
        });
      let zoom = 12;
      while (!fits(zoom)) zoom -= 0.05;
      const proj = (p: LatLon) => project(p, zoom);
      const base = l.basePath.map(proj);
      const alt = l.altPath.map(proj);
      const own = l.own.map(proj);
      const divergence = proj(l.divergence);
      const p = placeAltLabel({ own, base, alt, divergence, label: LABEL, viewport: area })!;
      // a horgony a saját szakasz pontja, a legtávolabbi közelében (legalább 80%-a) azok közül, amelyek mellett van a
      // leágazástól és a céltól szabad oldal (a cél melletti pontnál minden oldal a cél-jelölőre esne)
      const far = dist(p.anchor, base);
      expect(own.some((q) => q.x === p.anchor.x && q.y === p.anchor.y)).toBe(true);
      const clear = ALT_LABEL_PLACE.divergenceClearPx + ALT_LABEL_PLACE.gapPx + LABEL.h;
      const free = own.filter((q) => Math.hypot(q.x - divergence.x, q.y - divergence.y) >= clear && Math.hypot(q.x - base.at(-1)!.x, q.y - base.at(-1)!.y) >= clear);
      expect(far).toBeGreaterThanOrEqual(0.8 * Math.max(...free.map((q) => dist(q, base))));
      // a leágazást nem takarja, a horgony mellett van (rés), a képernyőn belül
      expect(boxDist(divergence, p.box)).toBeGreaterThanOrEqual(ALT_LABEL_PLACE.divergenceClearPx);
      expect(boxDist(base.at(-1)!, p.box)).toBeGreaterThanOrEqual(ALT_LABEL_PLACE.divergenceClearPx);
      // a cél-jelölő (alsó csúcsával a célon) dobozát sem takarja
      const d = base.at(-1)!;
      const pin = ALT_LABEL_PLACE.destPinPx;
      expect(p.box.x < d.x + pin / 2 && p.box.x + p.box.w > d.x - pin / 2 && p.box.y < d.y && p.box.y + p.box.h > d.y - pin).toBe(false);
      expect(boxDist(p.anchor, p.box)).toBeCloseTo(ALT_LABEL_PLACE.gapPx, 6);
      expect(p.box.x).toBeGreaterThanOrEqual(0);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(area.w);
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(area.h);
    });
  }
});

// ---------------------------------------------------------------------------
// AW18: útvonalválasztó, élő forgalom, helyi dugó, közösségi dugó-adat
// ---------------------------------------------------------------------------

/** Egyenletes haladás `fromS`-től `toS`-ig (mp-enként egy fix), `mps` sebességgel, `alongM`-től. Visszaadja a végső helyet. */
async function drive(
  h: Harness,
  route: NavRoute,
  o: { fromS: number; toS: number; alongM: number; mps: number; respond?: (s: number, along: number) => NavRoute[] | null; onStep?: (s: number) => unknown },
): Promise<number> {
  let along = o.alongM;
  for (let s = o.fromS; s <= o.toS; s++) {
    if (s > o.fromS) along += o.mps;
    const r = o.respond?.(s, along);
    if (r) h.respond(r);
    feed(h, at(route, along, 0, T0 + s * 1000, { speed: o.mps }));
    await flush();
    o.onStep?.(s);
  }
  return along;
}

/** A 100 km-es, 3600 s-os egyenes friss változata a pozíciótól: a tervezett hátralévő idő + `extraS` dugó. */
const freshFrom = (alongM: number, extraS: number, total = { lengthM: 100_000, durationS: 3600 }) =>
  lineRoute({ startX: alongM, lengthM: total.lengthM - alongM, durationS: (total.durationS * (total.lengthM - alongM)) / total.lengthM + extraS, id: `fresh-${alongM}` });

describe('AW18: útvonalválasztó – „Leggyorsabb” és a címke', () => {
  it('a „Leggyorsabb” címke és az előválasztás a legkisebb menetidejű útvonal, nem a 0. index', () => {
    // élesben: a Mapbox 0. útvonala 42 perc, az alternatíva 41
    expect(fastestRouteIndex([42 * 60, 41 * 60])).toBe(1);
    expect(fastestRouteIndex([41 * 60, 41 * 60, 45 * 60])).toBe(0);
    expect(fastestRouteIndex([50 * 60, 47 * 60, 46 * 60])).toBe(2);
    expect(fastestRouteIndex([])).toBe(0);
    expect(routeTagText(1, 1)).toBe('Leggyorsabb');
    expect(routeTagText(0, 1)).toBe('Alternatíva 1');
    expect(routeTagText(2, 1)).toBe('Alternatíva 2');
    expect(routeTagText(1, 0)).toBe('Alternatíva 1');
  });
});

describe('AW18: élő forgalom navigáció közben', () => {
  it('2 percenként friss lekérés; a jelenlegi útvonal friss ideje adja az ETA-t és a hátralévő időt (a lekérés helyétől)', async () => {
    const route = lineRoute({ lengthM: 100_000, durationS: 3600 });
    const h = harness(route, { voice: false });
    const v = 100_000 / 3600;
    const along = await drive(h, route, { fromS: 0, toS: 119, alongM: 0, mps: v });
    expect(h.calls).toHaveLength(0);
    h.respond([freshFrom(along + v, 600)]);
    await drive(h, route, { fromS: 120, toS: 120, alongM: along + v, mps: v });
    expect(h.calls.map((c) => c.reason)).toEqual(['alternatives']);
    const view = h.session.view();
    // a tervezett hátralévő idő + 10 perc dugó
    expect(view.remainingS).toBeCloseTo(3600 - 120 + 600, -1);
    // AW23: heavy / severe szakasz nélkül nincs „+N perc” (a friss ETA ettől még számít)
    expect(view.delayMin).toBeNull();
    // a friss útvonal mentén fogy tovább
    await drive(h, route, { fromS: 121, toS: 180, alongM: along + 2 * v, mps: v });
    // a 10 perc a friss útvonal teljes hosszán oszlik el: 60 s alatt annak arányos része fogy
    const left = 100_000 - 120 * v;
    expect(h.session.view().remainingS).toBeCloseTo((3600 - 120 + 600) * (1 - (60 * v) / left), -1);
  });

  it('ha a válaszban nincs a jelenlegi útvonal: forgalom-lekérés köztes ponttal a következő manőveren, a jelenlegi útvonalon', async () => {
    const route = lineRoute({ lengthM: 100_000, durationS: 3600 });
    const h = harness(route, { voice: false });
    const v = 100_000 / 3600;
    let along = await drive(h, route, { fromS: 0, toS: 119, alongM: 0, mps: v });
    // csak egy másik (lassabb, 5 km-rel északabbra futó) útvonal jön
    h.respond([lineRoute({ lengthM: 100_000, durationS: 9000, latOffset: 0.05, id: 'mas' })]);
    along = await drive(h, route, { fromS: 120, toS: 124, alongM: along + v, mps: v });
    expect(h.calls.map((c) => c.reason)).toEqual(['alternatives']);
    h.respond([freshFrom(along + v, 300)]);
    along = await drive(h, route, { fromS: 125, toS: 125, alongM: along + v, mps: v });
    expect(h.calls.map((c) => c.reason)).toEqual(['alternatives', 'traffic']);
    // a köztes pont a következő manőver (a lépés vége, 4 km-nél)
    const via = h.calls[1]!.via!;
    const m = route.steps[3]!.endManeuver.location;
    expect(via.lat).toBeCloseTo(m.lat, 6);
    expect(via.lon).toBeCloseTo(m.lon, 6);
    expect(h.session.view().trafficRoute.id).toContain('fresh');
    expect(h.session.view().offer).toBeNull();
  });

  it('a kérés címe köztes ponttal: három koordináta, waypoints=0;2, alternatíva nélkül; az irány az első ponté', () => {
    const url = directionsUrl({ lat: 47.5, lon: 19 }, { lat: 47.7, lon: 17.6 }, 'hu', 'pk.x', { heading: 90, via: { lat: 47.55, lon: 18.9 } });
    expect(url).toContain('/19.000000,47.500000;18.900000,47.550000;17.600000,47.700000?');
    const q = new URL(url).searchParams;
    expect(q.get('waypoints')).toBe('0;2');
    expect(q.get('alternatives')).toBe('false');
    expect(q.get('bearings')).toBe('90,45;;');
    // köztes pont nélkül a régi forma
    const plain = new URL(directionsUrl({ lat: 47.5, lon: 19 }, { lat: 47.7, lon: 17.6 }, 'hu', 'pk.x', { heading: 90 })).searchParams;
    expect(plain.get('waypoints')).toBeNull();
    expect(plain.get('alternatives')).toBe('true');
  });

  it('„+N perc dugó” 3 perctől; a hang csak az első alkalommal szól, a késés további növekedése néma (a sáv frissül)', async () => {
    const route = lineRoute({ lengthM: 100_000, durationS: 3600 });
    const h = harness(route);
    const v = 100_000 / 3600;
    const extra = [120, 240, 360, 480, 480];
    const said: string[] = [];
    const delays: (number | null)[] = [];
    await drive(h, route, {
      fromS: 0,
      toS: 600,
      alongM: 0,
      mps: v,
      respond: (s, along) => {
        if (!(s % 120 === 0 && s > 0)) return null;
        const r = freshFrom(along, extra[s / 120 - 1]!);
        r.segCongestion = r.segCongestion.map(() => 'heavy' as const);
        r.typicalDurationS = r.durationS - extra[s / 120 - 1]!;
        r.steps = r.steps.map((st) => ({ ...st, durationTypicalS: null }));
        return [r];
      },
      onStep: (s) => s % 120 === 5 && delays.push(h.session.view().delayMin),
    });
    for (const e of h.session.drainVoice()) if (e.kind === 'traffic') said.push(e.text);
    // 2 perc: nincs; 4 perc (240 s): „4 perccel” – egyszer; 6 és 8 perc: a sáv frissül, hang nincs
    expect(said).toEqual(['Dugó az útvonalon, az érkezés 4 perccel később.']);
    // a mintavétel 5 s-mal a lekérések után (5, 125, 245, 365, 485 s): a sáv minden friss adatnál frissül
    expect(delays).toEqual([null, null, 4, 6, 8]);
    expect(h.session.view().delayMin).toBe(8);
  });

  it('a puszta lassú haladás nem „+N perc dugó”', async () => {
    const route = lineRoute({ lengthM: 100_000, durationS: 3600 });
    const h = harness(route, { voice: false });
    // a tervezett tempó felével halad, de friss adat még nincs (az első 2 percben)
    await drive(h, route, { fromS: 0, toS: 110, alongM: 0, mps: 100_000 / 3600 / 1.6 });
    expect(h.session.view().delayMin).toBeNull();
  });

  it('a Directions-kliens hibájának oka: időtúllépés „timeout”, HTTP „http_<státusz>”, hálózat „network”', async () => {
    const store: SyncStore = { getItem: () => null, setItem: () => undefined };
    const counter = new RequestCounter(store, () => T0);
    const never = new DirectionsClient({ token: 'pk.x', lang: () => 'hu', fetch: () => new Promise(() => undefined), counter, now: () => T0, timeoutMs: 20 });
    const e = await never.routes({ lat: 47.5, lon: 19 }, { lat: 47.6, lon: 19.1 }, { heading: null, reason: 'reroute' }).catch((x: unknown) => x);
    expect(routeErrorKind(e)).toBe('timeout');
    const http = new DirectionsClient({ token: 'pk.x', lang: () => 'hu', fetch: async () => ({ ok: false, status: 503, json: async () => null }), counter, now: () => T0 });
    const e2 = await http.routes({ lat: 47.5, lon: 19 }, { lat: 47.6, lon: 19.1 }, { heading: null, reason: 'reroute' }).catch((x: unknown) => x);
    expect(routeErrorKind(e2)).toBe('http_503');
    expect(routeErrorKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(routeErrorKind(new Error('boom'))).toBe('network: boom');
    expect([1, 2, 3, 4, 5, 9].map(rerouteRetryDelayMs)).toEqual([5000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  });
});

describe('AW23: helyi dugó-érzékelés (a megengedett sebességhez mérve)', () => {
  const ctx = (kmh: number, o: Partial<JamContext> = {}): JamContext => ({ limitMps: kmh / 3.6, highway: kmh >= 110, nearStopPoint: false, heavyAhead: false, ...o });
  /** A detektor mp-enkénti etetése: `[mp, m/s]` szakaszok egymás után; alapból előtte 200 m szabad haladás (az ablak ne a parkolóból induljon). */
  function run(d: JamDetector, parts: [number, number][], c: JamContext, t0 = 0, along0 = 0, near?: (along: number) => boolean) {
    const changes: { s: number; c: string; along: number }[] = [];
    let s = t0;
    let along = along0;
    for (const [secs, mps] of parts) {
      for (let i = 0; i < secs; i++) {
        s++;
        along += mps;
        const x = d.update(s * 1000, along, mps, near ? { ...c, nearStopPoint: near(along) } : c);
        if (x) changes.push({ s, c: x, along });
      }
    }
    return { changes, s, along };
  }
  const warm: [number, number] = [20, 10];

  it('50-es városi út: 3 percig 20 km/h alatt (< 1 km) dugó; 20 km/h fölött nem', () => {
    const d = new JamDetector();
    const r = run(d, [warm, [190, 18 / 3.6]], ctx(50));
    expect(r.changes.map((c) => c.c)).toEqual(['enter']);
    expect(r.changes[0]!.s).toBeGreaterThanOrEqual(179);
    expect(r.changes[0]!.s).toBeLessThanOrEqual(20 + 182);
    expect(run(new JamDetector(), [warm, [400, 22 / 3.6]], ctx(50)).changes).toEqual([]);
  });

  it('90-es országút: 3 percig 36 km/h alatt (< 1,8 km) dugó; fölötte nem', () => {
    expect(run(new JamDetector(), [warm, [190, 34 / 3.6]], ctx(90)).changes.map((c) => c.c)).toEqual(['enter']);
    expect(run(new JamDetector(), [warm, [400, 38 / 3.6]], ctx(90)).changes).toEqual([]);
  });

  it('130-as autópálya: 3 percig 52 km/h alatt (< 2,6 km) dugó; fölötte nem', () => {
    expect(run(new JamDetector(), [warm, [190, 50 / 3.6]], ctx(130)).changes.map((c) => c.c)).toEqual(['enter']);
    expect(run(new JamDetector(), [warm, [400, 54 / 3.6]], ctx(130)).changes).toEqual([]);
  });

  it('piros lámpánál másodpercek múlva nem kérdez: a lassú előzmény után sem (a régi hiba)', () => {
    // éles eset: lassú, de még nem dugós haladás, majd megállás egy lámpánál – a régi 2 perces átlag másodpercek alatt átbillent
    const d = new JamDetector();
    const r = run(d, [warm, [170, 25 / 3.6], [90, 0]], ctx(50), 0, 0, () => true);
    expect(r.changes).toEqual([]);
    expect(d.active).toBe(false);
  });

  it('lámpa-türelem városban: 2 perc állás a lámpánál nem számít bele a 3 percbe; az autópályán nincs türelem', () => {
    // a lámpánál: 200 s állás → ebből 120 s nem számít, 80 s igen; a többi araszolás a küszöb alatt
    const city = run(new JamDetector(), [warm, [200, 0], [60, 3]], ctx(50), 0, 0, () => true);
    expect(city.changes).toEqual([]);
    const city2 = new JamDetector();
    const r = run(city2, [warm, [200, 0], [110, 3]], ctx(50), 0, 0, () => true);
    expect(r.changes.map((c) => c.c)).toEqual(['enter']);
    // ugyanez autópályán: a türelem nem érvényes, 180 s után dugó
    const hw = run(new JamDetector(), [warm, [200, 0]], ctx(130), 0, 0, () => true);
    expect(hw.changes.map((c) => c.c)).toEqual(['enter']);
    expect(hw.changes[0]!.s).toBeLessThanOrEqual(20 + 182);
    // autóúton sincs türelem
    expect(run(new JamDetector(), [warm, [200, 0]], ctx(110), 0, 0, () => true).changes.map((c) => c.c)).toEqual(['enter']);
  });

  it('megállás lámpa és kanyar nélkül rögtön számít, de a parkolóban várakozás (haladás előtt) nem dugó', () => {
    expect(run(new JamDetector(), [warm, [190, 0]], ctx(50)).changes.map((c) => c.c)).toEqual(['enter']);
    expect(run(new JamDetector(), [[400, 0]], ctx(50)).changes).toEqual([]);
  });

  it('a dugó vége: városban legalább 1 km és 2 perc a megengedett 70%-a fölött; rövidebb gyorsulás nem szakítja meg', () => {
    const d = new JamDetector();
    let r = run(d, [warm, [190, 2]], ctx(50));
    expect(d.active).toBe(true);
    r = run(d, [[60, 14], [30, 1]], ctx(50), r.s, r.along);
    expect(r.changes).toEqual([]);
    expect(d.active).toBe(true);
    r = run(d, [[125, 11]], ctx(50), r.s, r.along);
    expect(r.changes.map((c) => c.c)).toEqual(['exit']);
    expect(d.active).toBe(false);
    expect(d.clearedAvgMps!).toBeGreaterThan(0.7 * (50 / 3.6));
  });

  it('a dugó vége: autópályán legalább 3 km és 3 perc a megengedett 70%-a fölött', () => {
    const d = new JamDetector();
    let r = run(d, [warm, [190, 5]], ctx(130));
    expect(d.active).toBe(true);
    // 2 perc 100 km/h (3,3 km) még kevés: az idő nincs meg
    r = run(d, [[120, 100 / 3.6]], ctx(130), r.s, r.along);
    expect(d.active).toBe(true);
    r = run(d, [[70, 100 / 3.6]], ctx(130), r.s, r.along);
    expect(r.changes.map((c) => c.c)).toEqual(['exit']);
  });

  it('az ETA-korrekció addig marad, amíg a hátralévő úton heavy / severe szakasz van', () => {
    const d = new JamDetector();
    let r = run(d, [warm, [190, 2]], ctx(50));
    r = run(d, [[125, 11]], ctx(50, { heavyAhead: true }), r.s, r.along);
    expect(d.active).toBe(false);
    expect(d.correcting).toBe(true);
    r = run(d, [[3, 11]], ctx(50), r.s, r.along);
    expect(d.correcting).toBe(false);
  });

  it('a GPS-zaj álló helyzetben nem haladás (csak az útvonal menti előrehaladás számít)', () => {
    const d = new JamDetector();
    let along = 0;
    for (let s = 1; s <= 20; s++) d.update(s * 1000, (along += 10), 10, ctx(50));
    for (let s = 21; s <= 215; s++) {
      along += s % 2 ? 3 : -3;
      d.update(s * 1000, along, 0, ctx(50));
    }
    expect(d.active).toBe(true);
    expect(d.avgMps!).toBeLessThan(0.1);
  });

  it('a megengedett sebesség: a tábla, ennek hiányában az útkategória alapértelmezése', () => {
    const route = lineRoute({ lengthM: 2000, durationS: 200 });
    route.segLimitKmh = route.segLimitKmh.map(() => 70);
    expect(permittedKmhAt(route, 500)).toBe(70);
    route.segLimitKmh = route.segLimitKmh.map(() => null);
    const withClass = (c: string | null): NavRoute => ({ ...route, steps: route.steps.map((s) => ({ ...s, roadClass: c })) });
    expect(permittedKmhAt(withClass('motorway'), 500)).toBe(130);
    expect(permittedKmhAt(withClass('trunk'), 500)).toBe(110);
    expect(permittedKmhAt(withClass('primary'), 500)).toBe(90);
    expect(permittedKmhAt(withClass('street'), 500)).toBe(50);
    expect(highwayAt(withClass('motorway'), 500)).toBe(true);
    expect(highwayAt(withClass('trunk'), 500)).toBe(true);
    expect(highwayAt(withClass('primary'), 500)).toBe(false);
  });

  it('a Directions-lépés kereszteződése és jelzőlámpája a lámpa-pontok közé kerül; az útkategória a lépésből jön', () => {
    const json = structuredClone(BUDAPEST_GYOR_DIRECTIONS) as { routes: { legs: { steps: Record<string, unknown>[] }[]; geometry: { coordinates: number[][] } }[] };
    const r0 = json.routes[0]!;
    const c = r0.geometry.coordinates[3]!;
    r0.legs[0]!.steps[0]!.intersections = [{ location: c, bearings: [90, 270], traffic_signal: true, mapbox_streets_v8: { class: 'street' } }];
    const [route] = parseDirections(json);
    expect(route!.steps[0]!.roadClass).toBe('street');
    expect(route!.stopPointsM.length).toBeGreaterThan(route!.steps.length - 2);
    const near = route!.stopPointsM[0]!;
    expect(nearStopPoint(route!, near + 50)).toBe(true);
  });

  /** Szabad indulás (200 m), majd dugós araszolás, míg a kérdés be nem jön. */
  async function intoJam(h: ReturnType<typeof harness>, route: NavRoute, mps = 2) {
    const a = await drive(h, route, { fromS: 0, toS: 10, alongM: 0, mps: 20 });
    return drive(h, route, { fromS: 11, toS: 195, alongM: a + mps, mps });
  }

  it('dugóba lépéskor „Dugóba kerültél?” kártya + hang egyszer; 15 s után válasz nélkül eltűnik, a dugó-állapot marad', async () => {
    const route = lineRoute();
    const h = harness(route);
    const along = await intoJam(h, route);
    const v = h.session.view();
    expect(v.jam).toBe(true);
    expect(v.jamAsk).toBe(true);
    const said = h.session.drainVoice().filter((e) => e.kind === 'traffic');
    expect(said.map((e) => e.text)).toContain('Lassú forgalom. Dugóba kerültél?');
    await drive(h, route, { fromS: 196, toS: 215, alongM: along + 2, mps: 2 });
    expect(h.session.view().jamAsk).toBe(false);
    expect(h.session.view().jam).toBe(true);
    expect(h.session.drainVoice().filter((e) => e.text.includes('Dugóba'))).toHaveLength(0);
  });

  it('„Nem” → a dugó-állapot törlődik, 10 percig sehol nem kérdez újra; „Igen” → bejelentett közösségi minta', async () => {
    const route = lineRoute({ lengthM: 100_000, durationS: 3600 });
    const h = harness(route, { voice: false });
    let along = await intoJam(h, route, 1);
    expect(h.session.view().jamAsk).toBe(true);
    h.session.answerJam(false);
    expect(h.session.view().jamAsk).toBe(false);
    expect(h.session.view().jam).toBe(false);
    // másik szakaszon is lassú: 3 perc után újra dugó-állapot, de 10 percen belül nincs kérdés (a régi hiba: kétszer kérdezett)
    along = await drive(h, route, { fromS: 196, toS: 390, alongM: along + 1, mps: 1 });
    expect(h.session.view().jam).toBe(true);
    expect(h.session.view().jamAsk).toBe(false);
    expect(h.session.drainJamSamples().map((x) => x.kind)).toEqual(['erzekelt', 'erzekelt']);
    h.session.answerJam(true);
    const rep = h.session.drainJamSamples();
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ kind: 'bejelentett', heading_deg: 90, length_m: TRAFFIC.reportedLengthM });
  });

  it('dugóban az ETA a mért átlaggal csak a congestion szerinti heavy szakaszra, onnan a tervezett idővel', async () => {
    const route = lineRoute(); // 10 km, 360 s, 1 km-es lépések
    route.segCongestion = route.segCongestion.map((_, i) => (i < 15 ? ('heavy' as const) : ('low' as const))); // az első 1,5 km dugós
    const h = harness(route, { voice: false });
    // csak a helyi becslés (a 2 perces Mapbox-lekérés most nem ad választ)
    h.respond(new Error('hálózat'));
    await intoJam(h, route);
    const v = h.session.view();
    expect(v.jam).toBe(true);
    // ~570 m-nél: a dugós szakasz még 930 m / 2 m/s = 465 s, onnan a terv: 8,5 km → 306 s
    expect(v.remainingS).toBeCloseTo(465 + 306, -2);
    expect(v.remainingS).toBeGreaterThan(700);
    expect(h.session.drainJamSamples().map((x) => x.kind)).toEqual(['erzekelt']);
  });

  it('7,5 km egyenes, az első 1,5 km dugós: az ETA legfeljebb a dugós szakasz lassulásával nő, nem duplázódik', async () => {
    const route = lineRoute({ lengthM: 7500, durationS: 300 });
    route.segCongestion = route.segCongestion.map((_, i) => (i < 15 ? ('severe' as const) : ('low' as const)));
    const h = harness(route, { voice: false });
    h.respond(new Error('hálózat'));
    await intoJam(h, route);
    const v = h.session.view();
    expect(v.jam).toBe(true);
    // a növekmény a dugós szakasz ideje, nem a teljes hátralévő úté (6,9 km / 2 m/s = 3465 s)
    expect(v.remainingS!).toBeLessThan(290 + 1500 / 2);
    expect(v.remainingS!).toBeGreaterThan(290);
  });

  it('congestion-adat nélkül a mért átlag legfeljebb 1 km-ig számít, a tempó lineárisan átmegy a tervezettbe', async () => {
    const route = lineRoute({ lengthM: 7500, durationS: 300 });
    route.segCongestion = route.segCongestion.map(() => 'unknown' as const);
    const h = harness(route, { voice: false });
    h.respond(new Error('hálózat'));
    await intoJam(h, route);
    const v = h.session.view();
    expect(v.jam).toBe(true);
    // ~6,93 km hátra: terv 277 s; 1 km: lassú 500 s, terv 40 s → +(500−40)/2 = 230 s
    expect(v.remainingS).toBeCloseTo(277 + 230, -1);
    // adat nélkül nincs felirat
    expect(v.delayMin).toBeNull();
  });

  it('a helyi ETA-korrekció lejár, amint a tempó helyreáll és nincs heavy szakasz előttünk', async () => {
    const route = lineRoute({ lengthM: 20_000, durationS: 800 });
    route.segCongestion = route.segCongestion.map(() => 'unknown' as const);
    const h = harness(route, { voice: false });
    h.respond(new Error('hálózat'));
    const along = await intoJam(h, route);
    expect(h.session.view().jam).toBe(true);
    await drive(h, route, { fromS: 196, toS: 390, alongM: along + 26, mps: 26 });
    const v = h.session.view();
    expect(v.jam).toBe(false);
    expect(v.remainingS).toBeCloseTo((800 * v.remainingM) / 20_000, 0);
  });
});

describe('AW23: a „+N perc dugó” a hátralévő út congestion-adatából', () => {
  it('üres út (nincs heavy / severe): nincs felirat, késve sem – a régi hiba: az indulási tervhez mért késés', async () => {
    const route = lineRoute({ lengthM: 100_000, durationS: 3600 });
    const h = harness(route, { voice: false });
    await drive(h, route, { fromS: 0, toS: 600, alongM: 0, mps: 5, respond: (s, along) => (s % 120 === 0 && s > 0 ? [freshFrom(along, 600)] : null) });
    expect(h.session.view().delayMin).toBeNull();
    expect(routeDelayS(route)).toBe(0);
  });

  it('4 perces hátralévő út: a többlet nem lehet 5 perc (legfeljebb a hátralévő idő fele)', () => {
    const route = lineRoute({ lengthM: 4000, durationS: 240 });
    route.typicalDurationS = 0;
    route.segCongestion = route.segCongestion.map(() => 'severe' as const);
    expect(routeDelayS(route)).toBeLessThanOrEqual(120);
    const h = harness(route, { voice: false });
    feed(h, at(route, 0, 0, T0));
    expect(h.session.view().delayMin).toBeNull();
  });

  it('az útvonalválasztó és a navigáció ugyanazt számolja; csak a hátralévő rész számít', () => {
    const route = lineRoute({ lengthM: 10_000, durationS: 1200 });
    route.steps = route.steps.map((s) => ({ ...s, durationTypicalS: 40 }));
    route.typicalDurationS = 400;
    route.segCongestion = route.segCongestion.map((_, i) => (i >= 50 ? ('heavy' as const) : ('low' as const)));
    const h = harness(route, { voice: false });
    feed(h, at(route, 0, 0, T0));
    const summary = routeSummary(route, NO_ENFORCEMENT_DATA, T0);
    expect(summary.delayS).toBe(routeDelayS(route));
    expect(h.session.view().delayMin).toBe(Math.round(routeDelayS(route) / 60));
    // a dugós szakasz után: nincs többlet, a felirat eltűnik
    expect(routeDelayS(route, 9990)).toBe(routeDelayS(route, 9990) > 0 ? routeDelayS(route, 9990) : 0);
    route.segCongestion = route.segCongestion.map((_, i) => (i < 50 ? ('heavy' as const) : ('low' as const)));
    expect(routeDelayS(route, 6000)).toBe(0);
  });

  it('a felirat térképi szakaszt jelent: a friss válasz a térkép forrása is', async () => {
    const route = lineRoute({ lengthM: 100_000, durationS: 3600 });
    const h = harness(route, { voice: false });
    const jammed = (along: number) => {
      const r = freshFrom(along, 1200);
      r.segCongestion = r.segCongestion.map(() => 'heavy' as const);
      r.typicalDurationS = r.durationS - 1200;
      return r;
    };
    await drive(h, route, { fromS: 0, toS: 125, alongM: 0, mps: 100_000 / 3600, respond: (s, along) => (s === 120 ? [jammed(along)] : null) });
    const v = h.session.view();
    expect(v.delayMin).not.toBeNull();
    expect(v.trafficRoute).not.toBe(route);
    expect(congestionRuns(v.trafficRoute).some((x) => x.level === 'heavy')).toBe(true);
  });
});

describe('AW18: közösségi dugó-adat', () => {
  const route = lineRoute(); // 10 km, 360 s → 36 s / km
  const total = (d: readonly number[]) => d.reduce((a, b) => a + b, 0);
  const jam = (o: Partial<CommunityJam> = {}): CommunityJam => {
    const p = at(route, 5000);
    return { id: 'j', lat: p.lat, lon: p.lon, headingDeg: 90, avgKmh: 18, lengthM: 1000, createdAt: T0 - 60_000, own: false, ...o };
  };

  it('a 15 percnél frissebb, azonos irányú, más felhasználótól származó minta felülírja az érintett szakasz idejét a mért átlaggal', () => {
    // 4–5 km: 1000 m / 5 m/s = 200 s a 36 s helyett
    expect(total(applyCommunityJams(route, route.segDurationS, [jam()], T0))).toBeCloseTo(360 - 36 + 200, 3);
    // ellenirányú, saját, 16 perces, 100 m-re lévő: nem számít
    expect(total(applyCommunityJams(route, route.segDurationS, [jam({ headingDeg: 270 })], T0))).toBeCloseTo(360, 3);
    expect(total(applyCommunityJams(route, route.segDurationS, [jam({ own: true })], T0))).toBeCloseTo(360, 3);
    expect(total(applyCommunityJams(route, route.segDurationS, [jam({ createdAt: T0 - 16 * 60_000 })], T0))).toBeCloseTo(360, 3);
    const off = at(route, 5000, 100);
    expect(total(applyCommunityJams(route, route.segDurationS, [jam({ lat: off.lat, lon: off.lon })], T0))).toBeCloseTo(360, 3);
    // a frissebb nyer: a dugó után „oldott” 90 km/h-val → 1000 m / 25 m/s = 40 s
    const cleared = jam({ id: 'k', avgKmh: 90, createdAt: T0 - 10_000 });
    expect(total(applyCommunityJams(route, route.segDurationS, [cleared, jam()], T0))).toBeCloseTo(360 - 36 + 40, 3);
  });

  it('a munkamenet ETA-ja a közösségi adattal számol', () => {
    const h = harness(route, { voice: false });
    feed(h, at(route, 1000, 0, T0));
    const before = h.session.view().remainingS;
    h.session.setCommunityJams([jam()]);
    expect(h.session.view().remainingS - before).toBeCloseTo(164, 0);
  });

  it('a feltöltött minta: km/h egészre, irány 0–359, hossz legalább 1 m', () => {
    expect(jamSample('erzekelt', { lat: 47.5, lon: 19, heading: 361.6 }, 2.1, 0.2)).toEqual({ kind: 'erzekelt', lat: 47.5, lon: 19, heading_deg: 2, avg_kmh: 8, length_m: 1 });
    expect(jamSample('bejelentett', { lat: 47.5, lon: 19, heading: null }, 0, 300).heading_deg).toBeNull();
  });
});

describe('AW23: útvonal-panel, sorrend, „Utána” sor', () => {
  it('a leggyorsabb mindig legfelül: a kártyák sorrendje menetidő szerint', () => {
    expect(routeOrder([42 * 60, 41 * 60])).toEqual([1, 0]);
    expect(routeOrder([41 * 60, 41 * 60, 45 * 60])).toEqual([0, 1, 2]);
    expect(routeOrder([50, 47, 46])).toEqual([2, 1, 0]);
  });

  it('a hátralévő út eseményei a távval arányos helyen: kamera, szakasz, dugó, bejelentés; a mögöttünk lévő nincs', () => {
    const route = lineRoute(); // 10 km
    route.segCongestion = route.segCongestion.map((_, i) => (i >= 50 && i < 60 ? ('heavy' as const) : ('low' as const)));
    const item = (kind: 'camera' | 'section', startM: number) => ({ kind, id: kind, startM, endM: startM, limitKmh: null, label: '', verified: true, source: '' }) as unknown as EnforcementItem;
    const ev = routeTimeline(route, 2000, [item('camera', 4000), item('section', 1000), item('section', 7000)], [at(route, 9000), at(route, 9000, 500), at(route, 1000)]);
    expect(ev.map((e) => e.kind)).toEqual(['camera', 'jam', 'section', 'report']);
    expect(ev[0]!.at).toBeCloseTo(2000 / 8000, 5);
    expect(ev[1]!.aheadM).toBeCloseTo(3000, 0);
    expect(ev[3]!.at).toBeCloseTo(7000 / 8000, 2);
  });

  it('alternatívák navigáció közben: a jelenlegi pozícióból, a leggyorsabb elöl, a jelenlegit jelöli; választás után az új úton folytat', async () => {
    const route = lineRoute({ lengthM: 10_000, durationS: 600 });
    const h = harness(route, { voice: false });
    feed(h, at(route, 2000, 0, T0));
    const alt = scaleDurations(route, 300, 'alt', 0.05);
    h.respond([route, alt]);
    const choices = await h.session.requestAlternatives();
    expect(h.calls.map((c) => c.reason)).toEqual(['alternatives']);
    expect(choices.map((c) => c.route.id)).toEqual(['alt', route.id]);
    expect(choices.map((c) => c.current)).toEqual([false, true]);
    expect(h.session.view().phase).toBe('navigating');
    const before = h.session.view().routeVersion;
    h.session.useRoute(alt);
    expect(h.session.view().route.id).toBe('alt');
    expect(h.session.view().routeVersion).toBe(before + 1);
  });

  it('az „Utána” sor nem ismétli a következő manővert', () => {
    const route = lineRoute();
    route.steps = route.steps.map((s) => ({ ...s, banners: s.banners.map((b) => ({ ...b, primary: { ...b.primary, text: 'Március 15. tér' } })) }));
    const h = harness(route, { voice: false });
    feed(h, at(route, 100, 0, T0));
    const v = h.session.view();
    expect(v.next.text).toBe('Március 15. tér');
    expect(v.then).toBeNull();
  });
});

describe('AW23: Search Box', () => {
  it('a kérés címe: nyelv, országok, munkamenet-token, közelség és távolság a jelenlegi helyről', () => {
    const u = new URL(suggestUrl('Allee', 'hu', 'pk.x', 'tok', { lat: 47.5, lon: 19.04 }));
    expect(u.pathname).toBe('/search/searchbox/v1/suggest');
    expect(u.searchParams.get('q')).toBe('Allee');
    expect(u.searchParams.get('language')).toBe('hu');
    expect(u.searchParams.get('session_token')).toBe('tok');
    expect(u.searchParams.get('proximity')).toBe('19.04000,47.50000');
    expect(u.searchParams.get('origin')).toBe('19.04000,47.50000');
    expect(u.searchParams.get('country')).toContain('hu');
    const r = new URL(retrieveUrl('abc/d', 'de', 'pk.x', 'tok'));
    expect(r.pathname).toBe('/search/searchbox/v1/retrieve/abc%2Fd');
    expect(r.searchParams.get('session_token')).toBe('tok');
  });

  it('a találat: név + rövid cím + távolság; a kategória-találat kimarad; a koordináta a retrieve-ből jön, az útra eső ponttal', () => {
    const hits = parseSuggest({
      suggestions: [
        { name: 'Allee', mapbox_id: 'a1', feature_type: 'poi', address: 'Október huszonharmadika utca 8-10', place_formatted: 'Budapest, 1117, Magyarország', distance: 1234 },
        { name: 'Pláza', mapbox_id: 'c1', feature_type: 'category', place_formatted: '' },
        { name: 'Győr', mapbox_id: 'p1', feature_type: 'place', place_formatted: 'Győr-Moson-Sopron, Magyarország' },
      ],
    }, 'Allee');
    expect(hits.map((h) => h.name)).toEqual(['Allee', 'Győr']);
    expect(hits[0]).toMatchObject({ address: 'Október huszonharmadika utca 8-10, Budapest', distanceM: 1234, retrieveId: 'a1' });
    expect(hits[1]!.address).toBe('Győr-Moson-Sopron, Magyarország');
    const place = parseRetrieve(
      { features: [{ geometry: { coordinates: [19.05, 47.47] }, properties: { coordinates: { routable_points: [{ latitude: 47.471, longitude: 19.051 }] } } }] },
      hits[0]!,
    );
    expect(place).toEqual({ id: 'a1', name: 'Allee', address: 'Október huszonharmadika utca 8-10, Budapest', lat: 47.47, lon: 19.05, routable: { lat: 47.471, lon: 19.051 } });
    expect(parseRetrieve({ features: [] }, hits[0]!)).toBeNull();
  });

  it('a közeli találatok előre: a település és a pontos nevű közeli hely elöl, a távoli utca a végén', () => {
    const mk = (name: string, feature_type: string, distance: number) => ({ name, mapbox_id: name, feature_type, place_formatted: 'x', distance });
    const names = (q: string, list: unknown[]) => parseSuggest({ suggestions: list }, q).map((h) => h.name);
    expect(names('Allee', [mk('Allee', 'street', 188_760), mk('Allee Gyógyszertár', 'poi', 2535)])).toEqual(['Allee Gyógyszertár', 'Allee']);
    expect(names('Mammut', [mk('Mammut Gyerekpark', 'poi', 1565), mk('Mammut', 'poi', 1613)])).toEqual(['Mammut', 'Mammut Gyerekpark']);
    expect(names('Győr', [mk('Győri út', 'street', 900), mk('Győr', 'place', 110_000)])).toEqual(['Győr', 'Győri út']);
  });

  it('a Directions-kérés mindkét platformon ugyanaz: a paraméterek listája', () => {
    const u = new URL(directionsUrl({ lat: 47.4979, lon: 19.0402 }, { lat: 47.4731, lon: 19.0496 }, 'hu', 'pk.x'));
    expect(u.pathname).toBe('/directions/v5/mapbox/driving-traffic/19.040200,47.497900;19.049600,47.473100');
    expect([...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).join('&')).toBe('alternatives=true&steps=true&banner_instructions=true&voice_instructions=true&voice_units=metric&geometries=geojson&overview=full&annotations=maxspeed,congestion,duration&language=hu&access_token=pk.x');
  });

  it('a munkamenet-token: egy keresésen belül ugyanaz; új retrieve, 50 suggest és 2 perc tétlenség után', () => {
    let n = 0;
    let t = 0;
    const s = new SearchSession(() => `t${++n}`, () => t);
    expect(s.suggestToken()).toBe('t1');
    expect(s.suggestToken()).toBe('t1');
    expect(s.retrieveToken()).toBe('t1');
    expect(s.suggestToken()).toBe('t2');
    for (let i = 0; i < 49; i++) expect(s.suggestToken()).toBe('t2');
    expect(s.suggestToken()).toBe('t3');
    t += 120_001;
    expect(s.suggestToken()).toBe('t4');
  });

  it('a mentett és a korábbi helyek API-hívás nélkül, a találatok fölött; ékezet és kisbetű nem számít', () => {
    const home = { id: 'h', name: 'Otthon', address: 'Győri út 1', lat: 1, lon: 1 };
    const recent = { id: 'r', name: 'Mammut', address: 'Budapest', lat: 1, lon: 1 };
    expect(localMatches('gyori', { home, work: null, others: [] }, [recent]).map((p) => p.id)).toEqual(['h']);
    expect(localMatches('MAM', { home, work: null, others: [] }, [recent, recent]).map((p) => p.id)).toEqual(['r']);
    expect(localMatches('', { home, work: null, others: [] }, [recent])).toEqual([]);
  });
});
