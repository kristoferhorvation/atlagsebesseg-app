import { LocalProjection, Route, type GpsFix, type LatLon, type Section } from '@atlagsebesseg/core';
import type { FixedCamera } from '../src/cameras';
import { PLANNED_MATCH_M, type PlannedCheck } from '../src/plannedChecks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDAPEST_GYOR_DIRECTIONS } from '../src/navigation/fixtures';
import {
  absorbArrivalStub,
  addRecent,
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
  routeAvgKmh,
  routeTarget,
  savedChips,
  thenText,
  ALT_LABEL_AFTER_M,
  altDeltaText,
  altLabels,
  divergenceAlongM,
  congestionRuns,
  cumulative,
  DirectionsClient,
  directionsUrl,
  geocodeUrl,
  limitAt,
  maneuverIcon,
  NavigationSession,
  manualPillTap,
  manualMiniStatus,
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
  trafficDelayS,
  type NavRoute,
  type RouteFetcher,
  type SavedPlaces,
  type SearchState,
  type SyncStore,
} from '../src/navigation';
import { DICTIONARIES, LANGUAGES, setLanguage, t } from '../src/i18n';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings';
import { navFollowZoom } from '../src/follow';

afterEach(() => setLanguage('hu'));

// ---------------------------------------------------------------------------
// segédek
// ---------------------------------------------------------------------------

const T0 = 1_800_000_000_000;
const ORIGIN: LatLon = { lat: 47.5, lon: 19.0 };

/** Egyenes, kelet felé futó teszt-útvonal: `lengthM` hosszú, `durationS` idejű, lépésenként 1 km. */
function lineRoute(opts: { lengthM?: number; durationS?: number; latOffset?: number; limit?: number | null; id?: string } = {}): NavRoute {
  const lengthM = opts.lengthM ?? 10_000;
  const durationS = opts.durationS ?? 360;
  const proj = new LocalProjection({ lat: ORIGIN.lat + (opts.latOffset ?? 0), lon: ORIGIN.lon });
  const n = Math.round(lengthM / 100);
  const points = Array.from({ length: n + 1 }, (_, i) => proj.fromXY({ x: (i * lengthM) / n, y: 0 }));
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
  calls: { reason: string; from: LatLon; to: LatLon }[];
  clock: { t: number };
  respond: (r: NavRoute[] | Error) => void;
}

/** Munkamenet kézzel léptetett órával; a `fetchRoutes` hívásait rögzíti, a választ a teszt adja. */
function harness(route: NavRoute, opts: { voice?: boolean; reply?: () => NavRoute[]; routable?: LatLon } = {}): Harness {
  const clock = { t: T0 };
  const calls: Harness['calls'] = [];
  let next: NavRoute[] | Error = [route];
  const fetchRoutes: RouteFetcher = async (from, to, ctx) => {
    calls.push({ reason: ctx.reason, from, to });
    const r = opts.reply ? opts.reply() : next;
    if (r instanceof Error) throw r;
    return r;
  };
  const dest = { name: 'Cél', ...route.points.at(-1)!, ...(opts.routable ? { routable: opts.routable } : {}) };
  const session = new NavigationSession(route, dest, { fetchRoutes, now: () => clock.t, voice: opts.voice ?? true });
  return { session, calls, clock, respond: (r) => (next = r) };
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
    expect(trafficDelayS(r)).toBe(Math.max(0, Math.round(r.durationS - (r.typicalDurationS ?? r.durationS))));
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

  it('legfeljebb 1 újratervezés / 20 mp (sikertelen próba után is)', async () => {
    const route = lineRoute();
    const h = harness(route);
    h.respond(new Error('hálózat'));
    for (let s = 0; s <= 5; s++) feed(h, at(route, 2000, 300, T0 + s * 1000));
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.session.view().rerouteFailed).toBe(true);
    for (let s = 6; s < 25; s++) feed(h, at(route, 2000, 300, T0 + s * 1000));
    expect(h.calls).toHaveLength(1); // 5…24 mp: még a tilalmi időn belül
    feed(h, at(route, 2000, 300, T0 + 25_000)); // 20 mp telt el a kísérlet (5. mp) óta
    expect(h.calls).toHaveLength(2);
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

  /** A Budapest→Győr fixtúra: a jelenlegi útvonal és az igazi alternatíva (gyorsabbra skálázva); a lehajtója a 56. kilométernél van. */
  const fixture = () => {
    const [main, other] = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'fx') as [NavRoute, NavRoute];
    const core = new Route(main.points, main.distanceM);
    const alt = scaleDurations(other, main.durationS - 600, 'alt');
    const sectionOn = (fromM: number, toM: number): Section => {
      const a = core.pointAt(fromM);
      const b = core.pointAt(toM);
      return { ...makeSection(lineRoute(), 0, 1000), start: a, end: b, lengthM: toM - fromM };
    };
    const fix = (alongM: number, t: number): GpsFix => ({ ...core.pointAt(alongM), timestamp: t, speed: 25, accuracy: 5, heading: null });
    return { main, alt, sectionOn, fix };
  };

  async function measuringOn(sectionToM: number) {
    const f = fixture();
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

  it('bemondás Waze-mintára: azonnal, majd 500 m-nél még egyszer', async () => {
    const { h, f } = await measuringOn(70_000);
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

  it('a lehajtót 50 m-rel elhagyva az ajánlat eltűnik', async () => {
    const { h, f } = await measuringOn(70_000);
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

  it('összefoglaló: szakaszok, kamerák száma, késés', () => {
    const s = makeSection(route, 2000, 6000);
    const p = at(route, 8000, 5);
    const cam = { id: 'c', country: 'HU', type: 'speed', lat: p.lat, lon: p.lon, headingDeg: null, road: 'M1', speedLimitKmh: null, source: '', sourceUrl: '', sourceDate: '', verified: true } satisfies FixedCamera;
    const sum = routeSummary({ ...route, durationS: 420, typicalDurationS: 360 }, { sections: [s], cameras: [cam], planned: [] }, T0);
    expect(sum.sections).toBe(1);
    expect(sum.cameras).toBe(1);
    expect(sum.delayS).toBe(60);
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
    expect(list[0]!.id).toBe('p13');
    expect(list.at(-1)!.id).toBe('p4');
  });

  it('ugyanaz a hely nem duplázódik, hanem előre kerül', () => {
    let list = addRecent(addRecent([], p(1)), p(2));
    list = addRecent(list, { ...p(1), id: 'masik-azonosito', lat: 48.0004 });
    expect(list.map((x) => x.name)).toEqual(['Hely 1', 'Hely 2']);
  });

  it('sérült tárolt érték helyett üres lista / üres mentett helyek', () => {
    expect(parseRecents('nem json')).toEqual([]);
    expect(parseRecents('[{"x":1},null]')).toEqual([]);
    expect(parseSaved('???')).toEqual({ home: null, work: null, others: [] });
    expect(parseSaved(JSON.stringify({ home: p(1), work: 'x' }))).toMatchObject({ home: { name: 'Hely 1' }, work: null });
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

  it('a címke szövege: „+1 perc” / „−2 perc”, egy percen belül „Ugyanannyi idő”', () => {
    expect(altDeltaText(60)).toBe('+1 perc');
    expect(altDeltaText(-120)).toBe('−2 perc');
    expect(altDeltaText(-95)).toBe('−2 perc');
    expect(altDeltaText(25)).toBe('Ugyanannyi idő');
    setLanguage('en');
    expect(altDeltaText(180)).toBe('+3 min');
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

  it('címke csak az alternatíván, a leágazás után ~300 m-rel, a kártya menetidejével számolva', () => {
    const labels = altLabels(routes, [3600, 3660], 0);
    expect(labels).toHaveLength(1);
    const l = labels[0]!;
    expect(l).toMatchObject({ routeId: alt.id, index: 1, deltaS: 60, text: '+1 perc' });
    const a = new Route(alt.points, alt.distanceM);
    const at = a.project(l.at);
    expect(at.crossM).toBeLessThan(1);
    expect(at.alongM - divergenceAlongM(main, alt)!).toBeCloseTo(ALT_LABEL_AFTER_M, -1);
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
  it('„Kijárat 56” / „2,1 km · −7 perc”; név nélkül „Lehajtó 2,1 km-nél” / „−7 perc”; ismeretlen lehajtónál a cím', () => {
    const o = { title: 'Megéri · −7 perc, +4 km', gainS: 7 * 60 + 10, exitAlongM: 12_000, exitName: 'Kijárat 56', exitKm: '2,1' };
    expect(altOfferCompactLines(o)).toEqual(['Kijárat 56', '2,1 km · −7 perc']);
    expect(altOfferCompactLines({ ...o, exitName: null })).toEqual(['Lehajtó 2,1 km-nél', '−7 perc']);
    expect(altOfferCompactLines({ ...o, exitName: '' })).toEqual(['Lehajtó 2,1 km-nél', '−7 perc']);
    expect(altOfferCompactLines({ ...o, exitAlongM: null })).toEqual(['Megéri · −7 perc, +4 km', null]);
    expect(altOfferCompactLines({ ...o, gainS: 20 })[1]).toBe('2,1 km · −1 perc');
    for (const lang of LANGUAGES) {
      setLanguage(lang);
      const [, detail] = altOfferCompactLines(o);
      expect(detail, lang).toMatch(/^2,1 km · −7 \S+$/);
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

  it('követő zoom a sebességgel: < 40 km/h 17, 90 km/h 15,5, 130 km/h 14,5, között lineáris', () => {
    expect(navFollowZoom(0)).toBe(17);
    expect(navFollowZoom(40)).toBe(17);
    expect(navFollowZoom(65)).toBeCloseTo(16.25, 10);
    expect(navFollowZoom(90)).toBe(15.5);
    expect(navFollowZoom(110)).toBeCloseTo(15, 10);
    expect(navFollowZoom(130)).toBe(14.5);
    expect(navFollowZoom(180)).toBe(14.5);
    expect(navFollowZoom(NaN)).toBe(17);
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
    expect(parseSaved(JSON.stringify(saved)).others.map((x) => x.name)).toEqual(['Edzőterem', 'Nagymama']);
    expect(removeSavedOther(saved, 'p2').others.map((x) => x.id)).toEqual(['p3']);
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

  it('a zsugorított kártya státusz-színe a navigáció határából: jó / lassíts / túl gyors; ismeretlen határnál nincs', () => {
    expect(manualMiniStatus(88, 90, 90)).toBe('jo');
    expect(manualMiniStatus(95, 85, 90)).toBe('lassits');
    expect(manualMiniStatus(95, 100, 90)).toBe('tul_gyors');
    expect(manualMiniStatus(95, null, 90)).toBe('tul_gyors');
    expect(manualMiniStatus(null, 80, 90)).toBeNull();
    expect(manualMiniStatus(95, 85, null)).toBeNull();
  });
});
