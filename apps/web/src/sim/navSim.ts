import { BUDAPEST_GYOR_DIRECTIONS } from '@atlagsebesseg/app-logic/nav-fixtures';
import { DirectionsError, parseDirections, type ActiveReport, type FixedCamera, type NavRoute, type NavStep, type Place, type RouteFetcher } from '@atlagsebesseg/app-logic';
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

/**
 * A fixtúra két útvonala. AW18: `fasterAlt` (`?navsim&fasterAlt` / `-fasterAlt YES`) – a 2. útvonal 1 perccel gyorsabb a
 * 0.-nál (élesben a Mapbox 0. útvonala 42 perc volt, az alternatíva 41): a „Leggyorsabb” címke és az előválasztás a 2.-ra kerül.
 */
export const simMainRoutes = (fasterAlt = false): NavRoute[] => {
  const routes = parseDirections(BUDAPEST_GYOR_DIRECTIONS, 'sim');
  if (!fasterAlt || routes.length < 2) return routes;
  const [main, alt] = routes as [NavRoute, NavRoute];
  return [main, scaleRouteDuration(alt, main.durationS - SIM_FASTER_ALT_S), ...routes.slice(2)];
};

/** AW18: a `fasterAlt` módban ennyivel gyorsabb a 2. útvonal (s). */
export const SIM_FASTER_ALT_S = 60;

/** Az útvonal idejét `totalS`-re skálázza (a szakaszidőkkel és a lépésekkel együtt). */
function scaleRouteDuration(r: NavRoute, totalS: number): NavRoute {
  const k = totalS / r.durationS;
  return {
    ...r,
    durationS: totalS,
    typicalDurationS: r.typicalDurationS === null ? null : r.typicalDurationS * k,
    segDurationS: r.segDurationS.map((d) => d * k),
    steps: r.steps.map((st) => ({ ...st, durationS: st.durationS * k })),
  };
}

/**
 * AW18: a „dugó” mód (`?navsim&traffic`, iOS: `-traffic YES`): a fő útvonalon `fromM`–`toM` között dugó. A friss Mapbox-
 * lekérés (2 percenként / újratervezéskor) ezt `extraS` többletidővel mutatja; a vezetés ott araszol (álló–induló, a
 * gyorsulások `SIM_JAM_BURST_M`-esek, 500 m alatt), így a helyi dugó-érzékelés is bekapcsol.
 */
export const SIM_JAM = { fromM: 2200, toM: 2800, extraS: 420 } as const;
const SIM_JAM_BURST_M = 85;

/** A fő útvonal a dugóval: a `SIM_JAM` szakasz ideje `extraS`-sel több (a friss lekérések erre épülnek). */
export function jammedRoute(main: NavRoute, jam: { fromM: number; toM: number; extraS: number } = SIM_JAM): NavRoute {
  const idx = main.segStartM.flatMap((m, i) => (m >= jam.fromM && m < jam.toM ? [i] : []));
  const base = idx.reduce((a, i) => a + main.segDurationS[i]!, 0);
  if (base <= 0) return main;
  const k = (base + jam.extraS) / base;
  const segDurationS = main.segDurationS.map((d, i) => (idx.includes(i) ? d * k : d));
  return { ...main, segDurationS, durationS: main.durationS + jam.extraS, segCongestion: main.segCongestion.map((c, i) => (idx.includes(i) ? 'severe' : c)) };
}

/** A dugós mód sebessége a 1. ablakban (km/h, a megtett út szerint): a dugóban álló–induló araszolás (~12 km/h átlag). */
export function simTrafficSpeedKmh(s: number): number {
  if (s < 600) return 40;
  if (s < SIM_JAM.fromM) return 50;
  if (s < SIM_JAM.toM) return (s - SIM_JAM.fromM) % 100 < 100 - SIM_JAM_BURST_M ? 3 : 25;
  return 50;
}

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

/**
 * A szimulált lehajtó távolsága az alternatíva elejétől (m): a mérés közbeni ajánlatnál a szakaszon belül van. AW17:
 * 400 → 800 m, mert a „Megéri” ajánlat 500 m-en belül magától elfogad – a kártya így városi tempónál is ~20 s-ig
 * látszik.
 */
const SIM_EXIT_M = 800;

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
    banners: [{ distanceAlongM: cut, primary: { text: 'Kijárat 56', type: 'off ramp', modifier: 'right', exit: 'Kijárat 56' }, secondary: null, sub: null }],
    voice: [{ distanceAlongM: cut, text: 'Hajtson le a lehajtón' }],
  };
  const rest: NavStep = { ...target, startM: exitM, distanceM: target.distanceM - cut, durationS: target.durationS * (1 - cut / target.distanceM) };
  return [...steps.slice(0, at), exit, rest, ...steps.slice(at + 1)].map((s, k) => ({ ...s, index: k }));
}

/**
 * A szimulált alternatíva fajtája (AW12, `?navsim&alt=…`): a „megéri”-szabály három kategóriája, illetve egy, a mérés
 * végkapuja után 500 m-rel lehajtó (megéri-kategóriájú) alternatíva – erre mérés közben is azonnal, kompakt kártyával
 * és bemondással kell ajánlani (AW13: a kapu utáni 1 km-en belüli lehajtó nem vár a mérés végéig).
 */
export type SimAltMode = 'worth' | 'maybe' | 'not' | 'aftergate';
export const SIM_ALT_MODES: readonly SimAltMode[] = ['worth', 'maybe', 'not', 'aftergate'];

/** Nyereség (s) és többlet-táv (m) kategóriánként; az autópályás átlagsebességgel (~100 km/h, k ≈ 0,4 perc/km). */
export const SIM_ALTS: Record<SimAltMode, { gainS: number; extraM: number }> = {
  worth: { gainS: 420, extraM: 4000 },
  maybe: { gainS: 180, extraM: 5000 },
  not: { gainS: 600, extraM: 40_000 },
  aftergate: { gainS: 420, extraM: 4000 },
};

/** A kapu utáni lehajtó ennyivel a mért szakasz végkapuja után (m) – az `exitAfterGateM` (1 km) sávon belül: azonnali ajánlat. */
export const SIM_EXIT_AFTER_GATE_M = 500;

/**
 * Gyorsabb (de más vonalú) alternatíva: a fő útvonal ívesen eltolva, a hátralévő időnél `gainS`-sel rövidebb, `extraM`-rel
 * hosszabb; a lehajtó az elejétől `exitM` méterre.
 */
function fasterAlternative(base: NavRoute, id: string, gainS = 420, extraM = 0, exitM = SIM_EXIT_M): NavRoute {
  const n = base.points.length;
  const points = base.points.map((p, i) => ({ lat: p.lat + 0.0042 * Math.sin((Math.PI * i) / (n - 1)), lon: p.lon }));
  const lens = lengths(points);
  let geom = 0;
  for (const l of lens) geom += l;
  // a névleges hossz (mint a Directions `distance`): a fő útvonal + a kerülő; a geometriát erre skálázzuk
  const cum = base.distanceM + extraM;
  let acc = 0;
  const segStartM = lens.map((l) => {
    const s = acc;
    acc += (l * cum) / geom;
    return s;
  });
  const total = base.segDurationS.reduce((a, b) => a + b, 0);
  const k = Math.max(0.2, (total - gainS) / total);
  // a szimulált „visszahajtás” fejlépése csak a szimulátor műterméke (igazi, friss Directions-hívásban nincs): az alternatíva
  // nélküle indul. AW17-javítás: hossztól függetlenül (egy 200 m-es fejlépés lett a „lehajtó”, és a „Megéri” ajánlat az
  // 500 m-es szabály szerint azonnal átváltott)
  const head = base.steps[0];
  const baseSteps =
    head && head.endManeuver.type === 'merge' && base.steps.length > 1
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
    steps: withExit(shiftedSteps, new Route(points, cum), exitM),
  };
}

// ---------------------------------------------------------------------------
// a bejátszás
// ---------------------------------------------------------------------------

export interface NavSimData {
  main: NavRoute;
  detour: SimDetour;
  section: Section;
  /** A szakasz végkapuja a fő útvonal mentén (m). */
  sectionEndM: number;
  camera: FixedCamera;
  /** AOS14: minta-bejelentés az 1. ablakban (a közeledő bejelentés kártyájához a manőverkártya alatt). */
  reports: ActiveReport[];
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
export function buildNavSim(t0 = Date.now(), opts: { traffic?: boolean } = {}): NavSimData {
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

  // AOS14: rendőrség-bejelentés a fő útvonalon 1400 m-nél (az 1. ablakban, a letérés előtt), 12 perce jelentve
  const rp = proj.pointAt(1400);
  const reports: ActiveReport[] = [
    {
      id: 'sim-nav-report',
      type: 'rendorseg',
      gateKind: null,
      lat: rp.lat,
      lon: rp.lon,
      headingDeg: proj.bearingAt(1400),
      createdAt: t0 - 12 * 60_000,
      expiresAt: t0 - 12 * 60_000 + 2 * 3600_000,
      confirmations: 0,
      denials: 0,
      own: false,
    },
  ];

  const pathA = [...slice(main, 0, detour.fromAlongM), ...detour.points.slice(1), ...slice(main, detour.rejoinAlongM, 4600).slice(1)];
  const pathB = slice(main, S0 - 3200, S0 + 7000);
  const pathC = slice(main, D - 2600, D);
  const run = (path: LatLon[], at: number, speed: (s: number) => number, seed: number) =>
    drive({ path, t0: at, noiseM: 2.5, accuracy: 6, seed, speedKmh: speed });
  // AW18: dugós módban az 1. ablak letérés nélkül, a dugón át 5,2 km-ig
  const a = opts.traffic
    ? run(slice(main, 0, 5200), t0, simTrafficSpeedKmh, 11)
    : run(pathA, t0, (s) => (s < 600 ? 40 : s < 1900 ? 60 : SIM_DETOUR_SPEED_KMH), 11);
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
  return { main, detour, section, sectionEndM: S0 + 3000, camera, reports, samples: [...a, ...b, ...c], windows: [0, a.length, a.length + b.length] };
}

/**
 * A szimulátor Directions-szolgáltatója: tervezés a fixtúrából, újratervezés / alternatíva a fixtúra útvonalából. AW18:
 * `traffic` – a friss lekérések (alternatíva-figyelés, forgalom, újratervezés) a dugós fő útvonalból, alternatíva nélkül;
 * `fasterAlt` – a tervezésnél a 2. útvonal 1 perccel gyorsabb; `rerouteFail` (`?rerouteFail` / `-rerouteFail YES`) – az
 * újratervezés HTTP 503-mal bukik (a „nem sikerült” kártya visszaszámlálójához).
 */
export function simRouteFetcher(
  data: Pick<NavSimData, 'main' | 'detour' | 'sectionEndM'>,
  alt: SimAltMode = 'worth',
  opts: { traffic?: boolean; fasterAlt?: boolean; rerouteFail?: boolean } = {},
): RouteFetcher {
  let n = 0;
  const jammed = opts.traffic ? jammedRoute(data.main) : null;
  return async (from, _to, ctx) => {
    await new Promise((r) => setTimeout(r, 120));
    if (ctx.reason === 'plan') return simMainRoutes(opts.fasterAlt);
    if (opts.rerouteFail && ctx.reason === 'reroute') throw new DirectionsError('http_503');
    if (jammed) return [routeFrom(jammed, data.detour, from, `sim-${ctx.reason}-${++n}`)];
    const here = routeFrom(data.main, data.detour, from, `sim-${ctx.reason}-${++n}`);
    if (ctx.reason === 'reroute' || ctx.reason === 'traffic') return [here];
    // alternatíva-figyelés: a jelenlegi útvonal frissített változata + egy gyorsabb, a kért kategóriával
    const { gainS, extraM } = SIM_ALTS[alt];
    if (alt !== 'aftergate') return [here, fasterAlternative(here, `sim-fast-${alt}-${n}`, gainS, extraM)];
    // a kapu utáni lehajtó helyhez kötött: ha már elhagytuk, nincs ilyen alternatíva
    const exitM = data.sectionEndM + SIM_EXIT_AFTER_GATE_M - new Route(data.main.points, data.main.distanceM).project(from).alongM;
    return exitM > 100 ? [here, fasterAlternative(here, `sim-fast-${alt}-${n}`, gainS, extraM, exitM)] : [here];
  };
}

/** A szimulált fix a navigáció indulása előtt: állva a kiindulópontnál. */
export const simIdleFix = (t = Date.now()): GpsFix => ({ lat: SIM_FROM.lat, lon: SIM_FROM.lon, timestamp: t, speed: 0, accuracy: 5, heading: null });
