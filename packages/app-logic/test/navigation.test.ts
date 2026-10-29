import { LocalProjection, Route, type GpsFix, type LatLon, type Section } from '@atlagsebesseg/core';
import type { FixedCamera } from '../src/cameras';
import { PLANNED_MATCH_M, type PlannedCheck } from '../src/plannedChecks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDAPEST_GYOR_DIRECTIONS } from '../src/navigation/fixtures';
import {
  addRecent,
  adjustedDurations,
  congestionRuns,
  cumulative,
  DirectionsClient,
  directionsUrl,
  geocodeUrl,
  limitAt,
  maneuverIcon,
  NavigationSession,
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
  shouldSearch,
  trafficDelayS,
  type NavRoute,
  type RouteFetcher,
  type SearchState,
  type SyncStore,
} from '../src/navigation';
import { DICTIONARIES, LANGUAGES, setLanguage, t } from '../src/i18n';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings';

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
  calls: { reason: string; from: LatLon }[];
  clock: { t: number };
  respond: (r: NavRoute[] | Error) => void;
}

/** Munkamenet kézzel léptetett órával; a `fetchRoutes` hívásait rögzíti, a választ a teszt adja. */
function harness(route: NavRoute, opts: { voice?: boolean; reply?: () => NavRoute[] } = {}): Harness {
  const clock = { t: T0 };
  const calls: Harness['calls'] = [];
  let next: NavRoute[] | Error = [route];
  const fetchRoutes: RouteFetcher = async (from, _to, ctx) => {
    calls.push({ reason: ctx.reason, from });
    const r = opts.reply ? opts.reply() : next;
    if (r instanceof Error) throw r;
    return r;
  };
  const session = new NavigationSession(route, { name: 'Cél', ...route.points.at(-1)! }, { fetchRoutes, now: () => clock.t, voice: opts.voice ?? true });
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

  it('legalább 5 percet nyer → ajánlat', async () => {
    const offer = await offerWith(1800 - 360);
    expect(offer).not.toBeNull();
    expect(offer!.gainS).toBeGreaterThanOrEqual(300);
    expect(offer!.route.id).toBe('alt');
  });

  it('4 perc (és < 15%) → nincs ajánlat', async () => {
    expect(await offerWith(3600 - 240, 3600)).toBeNull();
  });

  it('15%-ot nyer 5 perc alatt is → ajánlat (rövid út)', async () => {
    // 20 perces út: 15% = 3 perc; a nyereség 3,5 perc
    const offer = await offerWith(1200 - 210, 1200);
    expect(offer).not.toBeNull();
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
    expect(exit!.distanceM).toBeGreaterThan(54_000);
    expect(exit!.distanceM).toBeLessThan(57_000);
    // a sáv/pajzs-jelzés („1”) nem tapad a kijárat nevére
    expect(exit!.name).toBe('Kijárat 56');
    expect(alt.steps.some((s) => s.banners[0]?.primary.text === 'Kijárat 56 1')).toBe(true);
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
      const step = copy.steps.find((s) => s.banners[0]?.primary.exit === 'Kijárat 56')!;
      edit(step.banners[0]!);
      return copy;
    };
    expect(firstNewManeuver(main, alt)!.name).toBe('Kijárat 56');
    expect(firstNewManeuver(main, withBanner((b) => (b.primary.exit = null)))!.name).toBe('Tatabánya-Óváros');
    expect(firstNewManeuver(main, withBanner((b) => ((b.primary.exit = null), (b.secondary = null))))!.name).toBeNull();
  });

  it('mérés közben: a lehajtó a szakasz vége előtt → azonnal, kompakt ajánlat a lehajtó nevével és távolságával', async () => {
    const { h } = await measuringOn(60_000);
    const offer = h.session.view().offer;
    expect(offer).not.toBeNull();
    expect(offer!.compact).toBe(true);
    expect(offer!.exitName).toBe('Kijárat 56');
    expect(offer!.exitInM).toBeGreaterThan(54_000);
    expect(offer!.expiresAt).toBe(T0 + 120_000 + NAV_CONFIG.offerTtlMs);
    const voice = h.session.drainVoice().filter((v) => v.kind === 'faster');
    expect(voice).toHaveLength(1);
    expect(voice[0]!.text).toContain(offer!.exitKm);
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
    const { h, f } = await measuringOn(60_000);
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
    const { h, f } = await measuringOn(60_000);
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
    expect(parseSaved('???')).toEqual({ home: null, work: null });
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
