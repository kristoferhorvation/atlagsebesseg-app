import { BUDAPEST_GYOR_DIRECTIONS } from '@atlagsebesseg/app-logic/nav-fixtures';
import { parseDirections, type FixedCamera, type NavRoute, type NavStep, type Place, type RouteFetcher } from '@atlagsebesseg/app-logic';
import { haversineM, LocalProjection, polylineLengthM, Route, type GpsFix, type LatLon, type Section } from '@atlagsebesseg/core';
import { drive, type DriveSample } from '@atlagsebesseg/core/test/helpers/trace';

/**
 * A navigációs szimulátor (A8): Budapest → Győr az M1-en. A Directions-válasz rögzített fixtúrából
 * jön (élő hívás nélkül); a keresés egy kis helyi lista; a letérés, az újratervezés és az
 * alternatíva-figyelés válasza a fixtúra útvonalából számolt, hogy a bejátszás determinisztikus legyen.
 */

export const SIM_FROM: LatLon = { lat: 47.4979, lon: 19.0402 };

export const SIM_PLACES: readonly Place[] = [
  { id: 'sim-gyor', name: 'Győr', address: 'Győr-Moson-Sopron, Magyarország', lat: 47.6875, lon: 17.6504 },
  { id: 'sim-gyor-vasut', name: 'Győr vasútállomás', address: 'Győr, Magyarország', lat: 47.6838, lon: 17.6347 },
  { id: 'sim-gyongyos', name: 'Gyöngyös', address: 'Heves, Magyarország', lat: 47.7827, lon: 19.9279 },
  { id: 'sim-budapest', name: 'Budapest', address: 'Magyarország', lat: 47.4979, lon: 19.0402 },
  { id: 'sim-wien', name: 'Wien', address: 'Österreich', lat: 48.2082, lon: 16.3738 },
];

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Helyi „keresés” a szimulátorban (nincs hálózati hívás). */
export async function simSearch(query: string): Promise<Place[]> {
  const q = plain(query.trim());
  return SIM_PLACES.filter((p) => plain(p.name).includes(q) || plain(p.address).includes(q));
}

export const simMainRoutes = (): NavRoute[] => parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'sim');

// ---------------------------------------------------------------------------
// útvonal-műveletek
// ---------------------------------------------------------------------------

const SIM_DETOUR_SPEED_KMH = 50;

function lengths(points: readonly LatLon[]): number[] {
  return points.slice(1).map((p, i) => haversineM(points[i]!, p));
}

/**
 * Új útvonal: `head` pontjai (az utolsó a csatlakozási pont a fő útvonalon, `joinAlongM`-nél), majd a fő
 * útvonal hátralévő része. A hátralévő lépések megmaradnak (az első csonkolva), elé egy szimulált lépés kerül.
 */
function splice(main: NavRoute, head: readonly LatLon[], joinAlongM: number, id: string): NavRoute {
  let tailStart = main.segStartM.findIndex((s) => s > joinAlongM + 1);
  if (tailStart < 0) tailStart = main.points.length - 1;
  const headPts = head.filter((p, i, a) => i === 0 || haversineM(a[i - 1]!, p) > 0.5);
  const tail = main.points.slice(tailStart).filter((p, i) => i > 0 || haversineM(headPts.at(-1)!, p) > 0.5);
  const points = [...headPts, ...tail];
  const lens = lengths(points);
  // a fej szakaszai (a csatlakozási pontig és az összekötő), majd a fő útvonal saját szakaszai
  const headSegs = points.length - tail.length;
  const segStartM: number[] = [];
  let cum = 0;
  for (const l of lens) {
    segStartM.push(cum);
    cum += l;
  }
  const tailFrom = main.segLimitKmh.length - (lens.length - headSegs);
  const segLimitKmh = [...Array.from({ length: headSegs }, () => SIM_DETOUR_SPEED_KMH), ...main.segLimitKmh.slice(tailFrom)];
  const segCongestion = [...Array.from({ length: headSegs }, () => 'low' as const), ...main.segCongestion.slice(tailFrom)];
  const segDurationS = [...lens.slice(0, headSegs).map((l) => l / (SIM_DETOUR_SPEED_KMH / 3.6)), ...main.segDurationS.slice(tailFrom)];
  const headLen = lens.slice(0, headSegs).reduce((a, b) => a + b, 0);

  // lépések: a csonkolt fő-lépések elé egy szimulált „haladjon tovább” lépés
  const rest: NavStep[] = [];
  for (const s of main.steps) {
    const end = s.startM + s.distanceM;
    if (end <= joinAlongM + 1) continue;
    const cut = Math.max(0, joinAlongM - s.startM);
    rest.push({ ...s, startM: headLen + Math.max(0, s.startM - joinAlongM), distanceM: s.distanceM - cut, durationS: s.durationS * ((s.distanceM - cut) / (s.distanceM || 1)) });
  }
  const first = rest[0];
  const headStep: NavStep = {
    index: 0,
    distanceM: headLen,
    durationS: headLen / (SIM_DETOUR_SPEED_KMH / 3.6),
    startM: 0,
    name: '',
    endManeuver: { type: 'merge', modifier: 'slight right', instruction: 'Hajtson vissza az M1-re', location: points[Math.min(headSegs, points.length - 1)]! },
    banners: [{ distanceAlongM: headLen, primary: { text: first?.name || 'M1', type: 'merge', modifier: 'slight right' }, secondary: null, sub: null }],
    voice: [{ distanceAlongM: headLen, text: 'Hajtson vissza az M1-re' }],
  };
  const steps = [headStep, ...rest].map((s, i) => ({ ...s, index: i }));
  const durationS = segDurationS.reduce((a, b) => a + b, 0);
  return { id, points, distanceM: cum, durationS, typicalDurationS: durationS, steps, segStartM, segLimitKmh, segCongestion, segDurationS };
}

// ---------------------------------------------------------------------------
// letérés: egy mellékút, amit az újratervezés követ
// ---------------------------------------------------------------------------

export interface SimDetour {
  /** A mellékút pontjai (a fő útvonalról leágazástól a visszacsatlakozásig). */
  points: LatLon[];
  fromAlongM: number;
  rejoinAlongM: number;
}

function buildDetour(main: NavRoute, fromAlongM: number): SimDetour {
  const route = new Route(main.points, main.distanceM);
  const j0 = route.pointAt(fromAlongM);
  const bearing = (route.bearingAt(fromAlongM) * Math.PI) / 180;
  const proj = new LocalProjection(j0);
  const smooth = (k: number) => k * k * (3 - 2 * k);
  // (előre, oldalra) méter; jobbra kitérő mellékút
  const prof: [number, number][] = [];
  for (let f = 0; f <= 600; f += 50) {
    const lateral = f <= 200 ? 350 * smooth(f / 200) : f <= 400 ? 350 : 350 * (1 - smooth((f - 400) / 200));
    prof.push([f, lateral]);
  }
  const points = prof.map(([f, l]) => proj.fromXY({ x: Math.sin(bearing) * f + Math.cos(bearing) * l, y: Math.cos(bearing) * f - Math.sin(bearing) * l }));
  return { points, fromAlongM, rejoinAlongM: fromAlongM + 600 };
}

/** Az útvonal a megadott pozícióból: a mellékúton a mellékút maradéka, különben a fő útvonal hátralévő része. */
function routeFrom(main: NavRoute, detour: SimDetour, from: LatLon, id: string): NavRoute {
  const route = new Route(main.points, main.distanceM);
  const onMain = route.project(from);
  if (onMain.crossM > 60) {
    const dRoute = new Route(detour.points);
    const onDetour = dRoute.project(from);
    const rest = detour.points.filter((_, i) => i > 0 && dRoute.project(detour.points[i]!).alongM > onDetour.alongM + 5);
    return splice(main, [from, ...rest], detour.rejoinAlongM, id);
  }
  const join = Math.min(main.distanceM - 5, onMain.alongM + 20);
  return splice(main, [from, route.pointAt(join)], join, id);
}

/** A szimulált lehajtó távolsága az alternatíva elejétől (m): a mérés közbeni ajánlatnál a szakaszon belül van. */
const SIM_EXIT_M = 400;

/** Az első lépést a lehajtó helyén kettévágja: a lehajtó-manőver az, ami a jelenlegi útvonalon nincs meg. */
function withExit(steps: NavStep[], route: Route, exitM: number): NavStep[] {
  const at = steps.findIndex((s) => s.startM < exitM && s.startM + s.distanceM > exitM + 50);
  const target = steps[at];
  if (!target) return steps;
  const cut = exitM - target.startM;
  const exit: NavStep = {
    ...target,
    distanceM: cut,
    durationS: target.durationS * (cut / target.distanceM),
    endManeuver: { type: 'off ramp', modifier: 'right', instruction: 'Hajtson le a lehajtón', location: route.pointAt(exitM) },
    banners: [{ distanceAlongM: cut, primary: { text: 'Kijárat 56', type: 'off ramp', modifier: 'right' }, secondary: null, sub: null }],
    voice: [{ distanceAlongM: cut, text: 'Hajtson le a lehajtón' }],
  };
  const rest: NavStep = { ...target, startM: exitM, distanceM: target.distanceM - cut, durationS: target.durationS * (1 - cut / target.distanceM) };
  return [...steps.slice(0, at), exit, rest, ...steps.slice(at + 1)].map((s, k) => ({ ...s, index: k }));
}

/** Gyorsabb (de más vonalú) alternatíva: a fő útvonal ívesen eltolva, a hátralévő időnél 7 perccel rövidebb. */
function fasterAlternative(base: NavRoute, id: string, gainS = 420): NavRoute {
  const n = base.points.length;
  const points = base.points.map((p, i) => ({ lat: p.lat + 0.0042 * Math.sin((Math.PI * i) / (n - 1)), lon: p.lon }));
  const lens = lengths(points);
  let cum = 0;
  const segStartM = lens.map((l) => {
    const s = cum;
    cum += l;
    return s;
  });
  const total = base.segDurationS.reduce((a, b) => a + b, 0);
  const k = Math.max(0.2, (total - gainS) / total);
  // a szimulált „visszahajtás” rövid fejlépése csak a szimulátor műterméke (igazi, friss Directions-hívásban nincs): az alternatíva nélküle indul
  const head = base.steps[0];
  const baseSteps =
    head && head.endManeuver.type === 'merge' && head.distanceM < 150 && base.steps.length > 1
      ? base.steps.slice(1).map((s, k) => (k === 0 ? { ...s, startM: 0, distanceM: s.distanceM + head.distanceM } : s))
      : base.steps;
  const shiftedSteps = baseSteps.map((s) => {
      // az első 0,8 km-en az alternatíva ugyanazt a vonalat követi; utána tér le (az ottani manőver a lehajtó)
      const eased = s.startM + s.distanceM > 800;
      const f = Math.min(1, (s.startM + s.distanceM) / base.distanceM);
      const loc = s.endManeuver.location;
      return {
        ...s,
        startM: s.startM * (cum / base.distanceM),
        distanceM: s.distanceM * (cum / base.distanceM),
        endManeuver: { ...s.endManeuver, location: eased ? { lat: loc.lat + 0.0042 * Math.max(0.2, Math.sin(Math.PI * f)), lon: loc.lon } : loc },
      };
    });
  return {
    ...base,
    id,
    points,
    distanceM: cum,
    durationS: total * k,
    typicalDurationS: total * k,
    segStartM,
    segDurationS: base.segDurationS.map((d) => d * k),
    steps: withExit(shiftedSteps, new Route(points, cum), SIM_EXIT_M),
  };
}

// ---------------------------------------------------------------------------
// a bejátszás
// ---------------------------------------------------------------------------

export interface NavSimData {
  main: NavRoute;
  detour: SimDetour;
  section: Section;
  camera: FixedCamera;
  /** A bejátszott fixek: 1. ablak (indulás + letérés), 2. ablak (szakasz + kamera), 3. ablak (érkezés). */
  samples: DriveSample[];
  /** Az ablakok határai a `samples`-ben (indexek). */
  windows: number[];
}

const slice = (main: NavRoute, fromM: number, toM: number): LatLon[] => {
  const route = new Route(main.points, main.distanceM);
  const out: LatLon[] = [];
  for (let s = fromM; s < toM; s += 100) out.push(route.pointAt(s));
  out.push(route.pointAt(toM));
  return out;
};

/**
 * A forgatókönyv: az 1. ablakban a belvárosból indulás és egy letérés (mellékút), a 2. ablakban az M1-en egy
 * szakaszellenőrzés (közeledés, mérés, a „túl gyors” állapottal) és egy kamera, a 3. ablakban az érkezés.
 * Az ablakok közt a pozíció ugrik (a 120 km-es út nem játszandó végig), az óra folytonos.
 */
export function buildNavSim(t0 = Date.now()): NavSimData {
  const main = simMainRoutes()[0]!;
  const D = main.distanceM;
  const detour = buildDetour(main, 2000);
  const proj = new Route(main.points, main.distanceM);

  // szimulált mérőszakasz az M1-en (a fixtúra útvonalából), határ 110
  const S0 = Math.round(D * 0.55);
  const secPts = slice(main, S0, S0 + 3000);
  const section: Section = {
    id: 'SIM-M1-NAV',
    country: 'HU',
    road: 'M1',
    direction: 'Budapest → Győr',
    start: secPts[0]!,
    end: secPts.at(-1)!,
    lengthM: polylineLengthM(secPts),
    speedLimitKmh: 110,
    source: 'hivatalos',
    verified: true,
    geometry: secPts,
    provenance: { name: 'Szimulátor (minta)', url: 'https://example.invalid/', date: '2026-10', locatedBy: 'koordinata' },
  };
  // kamera az út szélén (20 m-re), a szakasz után
  const camAlong = S0 + 5200;
  const cp = proj.pointAt(camAlong);
  const cb = (proj.bearingAt(camAlong) * Math.PI) / 180;
  const cproj = new LocalProjection(cp);
  const camPos = cproj.fromXY({ x: Math.cos(cb) * 20, y: -Math.sin(cb) * 20 });
  const camera: FixedCamera = {
    id: 'sim-nav-cam',
    country: 'HU',
    type: 'complex',
    lat: camPos.lat,
    lon: camPos.lon,
    headingDeg: (cb * 180) / Math.PI,
    road: 'M1',
    speedLimitKmh: 130,
    source: 'Szimulátor (VÉDA-minta)',
    sourceUrl: 'https://example.invalid/',
    sourceDate: '2026-10',
    verified: true,
  };

  const pathA = [...slice(main, 0, detour.fromAlongM), ...detour.points.slice(1), ...slice(main, detour.rejoinAlongM, 4600).slice(1)];
  const pathB = slice(main, S0 - 3200, S0 + 7000);
  const pathC = slice(main, D - 2600, D);
  const run = (path: LatLon[], at: number, speed: (s: number) => number, seed: number) =>
    drive({ path, t0: at, noiseM: 2.5, accuracy: 6, seed, speedKmh: speed });
  const a = run(pathA, t0, (s) => (s < 600 ? 40 : s < 1900 ? 60 : SIM_DETOUR_SPEED_KMH), 11);
  const aEnd = a.at(-1)!.t + 1000;
  const bStartS = 3200;
  const b = run(
    pathB,
    aEnd,
    (s) => {
      if (s < bStartS) return 118; // közeledés
      const f = (s - bStartS) / section.lengthM;
      if (f < 1) return f < 0.4 ? 128 : 94; // a szakaszon: gyors, majd lassít
      return 120;
    },
    12,
  );
  const bEnd = b.at(-1)!.t + 1000;
  const c = run(pathC, bEnd, (s) => (s < 1800 ? 100 : 50), 13);
  return { main, detour, section, camera, samples: [...a, ...b, ...c], windows: [0, a.length, a.length + b.length] };
}

/** A szimulátor Directions-szolgáltatója: tervezés a fixtúrából, újratervezés / alternatíva a fixtúra útvonalából. */
export function simRouteFetcher(data: Pick<NavSimData, 'main' | 'detour'>): RouteFetcher {
  let n = 0;
  return async (from, _to, ctx) => {
    await new Promise((r) => setTimeout(r, 120));
    if (ctx.reason === 'plan') return simMainRoutes();
    const here = routeFrom(data.main, data.detour, from, `sim-${ctx.reason}-${++n}`);
    if (ctx.reason === 'reroute') return [here];
    // alternatíva-figyelés: a jelenlegi útvonal frissített változata + egy 7 perccel gyorsabb
    return [here, fasterAlternative(here, `sim-fast-${n}`)];
  };
}

/** A szimulált fix a navigáció indulása előtt: állva a kiindulópontnál. */
export const simIdleFix = (t = Date.now()): GpsFix => ({ lat: SIM_FROM.lat, lon: SIM_FROM.lon, timestamp: t, speed: 0, accuracy: 5, heading: null });
