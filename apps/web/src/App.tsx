import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  altLabels,
  NAV_FOLLOW,
  congestionRuns,
  cameraLabel,
  cameraVisibility,
  cameraWarning,
  createJamSamples,
  createReports,
  currentUserId,
  isJamReport,
  jamQueryBBox,
  listActiveJams,
  rowToCommunityJam,
  detectBrowser,
  gpsPillAction,
  listActiveReports,
  mergeById,
  ownReport,
  plannedCheckActive,
  PlannedCheckWatch,
  ReportPromptWatch,
  gateStartedAfter,
  type ReportPrompt,
  greetingText,
  reportVisual,
  rowToActiveReport,
  visibleCameras,
  voteReport,
  type ActiveReport,
  type FixedCamera,
  type PlannedCheck,
  type BBox,
  reportChoiceLabel,
  reportFromFix,
  t,
  type TKey,
  type ReportChoice,
  type ReportInsert,
  type SessionView,
  type EnforcementData,
  type NavigationSession,
  type NavRoute,
  navBottomShowsSpeed,
  navMeterCompact,
  navResultCompact,
  navSpeedOver,
  slowDownBarShown,
  navStepStrip,
  mapLightPreset,
  strongGlassFor,
  manualPillTap,
  manualPillTick,
  navNeedsSpace,
  type ManualPillState,
} from '@atlagsebesseg/app-logic';
import { BUNDLED_CAMERAS } from '@atlagsebesseg/app-logic/bundled-cameras';
import { BUNDLED_SECTIONS } from '@atlagsebesseg/app-logic/bundled-sections';
import { haversineM, type GpsFix, type LatLon, type Section } from '@atlagsebesseg/core';
import { statusColor } from '@atlagsebesseg/design-tokens';
import { cameraCache, plannedCache, supabase } from './backend';
import { directionsClient, requestCounter, searchPlaces } from './nav/backend';
import { loadRouteData } from './nav/routeData';
import { usePlaces, useNavigation } from './nav/useNavigation';
import { useLanguage } from './i18n';
import { useFollow } from './hooks/useFollow';
import { useGeolocation, type GeoStatus } from './hooks/useGeolocation';
import { useLightPreset } from './hooks/useLightPreset';
import { useReports } from './hooks/useReports';
import { useSections } from './hooks/useSections';
import { useSession } from './hooks/useSession';
import { useSettings } from './hooks/useSettings';
import { useTileItems } from './hooks/useTileItems';
import { useWakeLock } from './hooks/useWakeLock';
import { createWebMapAdapter, type MapReport, type MapRoute, type WebMapAdapter } from './map';
import { simCameras, simPlannedChecks, simReports } from './sim/scenarios';
import { simStartFromUrl, useSimulator } from './sim/useSimulator';
import { buildNavSim, simIdleFix, simRouteFetcher, simSearch, SIM_ALT_MODES, SIM_PLACES, type NavSimData, type SimAltMode } from './sim/navSim';
import { CameraCard } from './ui/CameraCard';
import { cameraIcon } from './ui/cameraIcon';
import { Hud, ManualMini, SlowDown, toneOf } from './ui/Hud';
import { Icon, type IconName } from './ui/Icon';
import { LimitSign } from './ui/LimitSign';
import { JamAskCard, NavBottom, NavStrip, NavTop, OfferCard, ReportAlertCard, type JamAskProps, type ReportAlertProps } from './ui/NavHud';
import { RoutePicker } from './ui/RoutePicker';
import { SearchScreen } from './ui/SearchScreen';
import { PlannedBand } from './ui/PlannedBand';
import { ReportCard } from './ui/ReportCard';
import { GeoBlockedSheet } from './ui/GeoBlockedSheet';
import { ReportSheet } from './ui/ReportSheet';
import { SettingsSheet } from './ui/SettingsSheet';
import { SimPanel } from './ui/SimPanel';
import { StartScreen } from './ui/StartScreen';
import { StatusPills } from './ui/StatusPills';

/** `?navsim`: a navigációs szimulátor (Budapest → Győr, rögzített Directions-fixtúrával). */
const NAV_SIM = new URLSearchParams(location.search).has('navsim');
/** `?navsim&alt=worth|maybe|not|aftergate`: a szimulált gyorsabb út kategóriája (AW12); alapból „megéri”. */
const NAV_SIM_ALT: SimAltMode = (SIM_ALT_MODES as readonly string[]).includes(new URLSearchParams(location.search).get('alt') ?? '') ? (new URLSearchParams(location.search).get('alt') as SimAltMode) : 'worth';
const SIM_MODE = new URLSearchParams(location.search).has('sim') || NAV_SIM;
/**
 * AW18: `?navsim&traffic` – dugó mód (a friss Mapbox-lekérések dugót mutatnak, a vezetés araszol); `&fasterAlt` – a
 * tervezésnél a 2. útvonal 1 perccel gyorsabb; `&rerouteFail` – az újratervezés HTTP 503-mal bukik.
 */
const NAV_SIM_OPTS = (() => {
  const q = new URLSearchParams(location.search);
  return { traffic: q.has('traffic'), fasterAlt: q.has('fasterAlt'), rerouteFail: q.has('rerouteFail') };
})();
/** `?sim&panel=0`: a szimulátor vezérlője és jelzése nélkül (marketing-képernyőképekhez). */
const SIM_PANEL = new URLSearchParams(location.search).get('panel') !== '0' && !NAV_SIM;
/** `?sunAt=<ISO-idő>`: a térkép fénye ehhez az időponthoz (napszak-képernyőképekhez, AW16); alapból a valós idő. */
const SUN_AT = (() => {
  const ms = Date.parse(new URLSearchParams(location.search).get('sunAt') ?? '');
  return Number.isFinite(ms) ? ms : null;
})();
const sunAtNow = () => SUN_AT ?? Date.now();
/** A kamerák ekkora körzetben kerülnek a térképre (DOM-jelölők – nem az egész ország). */
const CAMERA_RADIUS_M = 15_000;
const NO_PLANNED: readonly PlannedCheck[] = [];
/** Mérés közben a bejelentés-kártya ennyi idő után magától bezárul (mérésen kívül nyitva marad). */
const REPORT_CARD_AUTOCLOSE_MS = 3000;

/** A szerver aktív bejelentései a téglalapban; a saját sorokat a meglévő munkamenetből ismeri fel. */
async function fetchServerReports(b: BBox): Promise<ActiveReport[]> {
  if (!supabase) return [];
  const [rows, uid] = await Promise.all([listActiveReports(supabase, b), currentUserId(supabase)]);
  return rows.map((r) => rowToActiveReport(r, uid));
}

export function App() {
  // a t() globális: a gyökér a nyelvváltásra újrarenderel, vele a teljes fa
  useLanguage();
  const [map, setMap] = useState<WebMapAdapter | null>(null);
  const [started, setStarted] = useState(SIM_MODE);
  useEffect(() => {
    void createWebMapAdapter(import.meta.env.VITE_MAPBOX_TOKEN ?? '').then(setMap);
  }, []);

  return (
    <div className="app">
      {map ? <map.MapView className="map" /> : <div className="map map-fallback" />}
      <div className="scrim-top" />
      <div className="scrim-bottom" />
      {map && started && <Drive map={map} />}
      {!started && <StartScreen onStart={() => setStarted(true)} />}
    </div>
  );
}

interface Toast {
  id: number;
  text: string;
  tone: string;
  icon: IconName;
  /** Megjelenési idő (ms), alapból 2,6 s. */
  ms?: number;
}

const GEO_TEXT: Record<GeoStatus, TKey> = {
  ki: 'geo.off',
  kereses: 'geo.searching',
  aktiv: 'geo.active',
  elutasitva: 'geo.denied',
  nem_elerheto: 'geo.unavailable',
  hiba: 'geo.error',
};

/** A vezetés közbeni képernyő: mérés-munkamenet + GPS vagy szimulátor + térkép + HUD. */
function Drive({ map }: { map: WebMapAdapter }) {
  const { lang } = useLanguage();
  const { settings, update } = useSettings();
  const clock = useRef<() => number>(Date.now);
  const now = useCallback(() => clock.current(), []);
  const [tileFix, setTileFix] = useState<GpsFix | null>(null);
  const [simSection, setSimSection] = useState<Section | null>(null);
  const { sections, status: sectionsStatus } = useSections(SIM_MODE ? null : tileFix);
  const all = useMemo(() => (simSection ? mergeById(sections, [simSection]) : sections), [sections, simSection]);
  const session = useSession(all, now);
  const { view } = session;

  // navigáció (A8): a munkamenet ugyanazokat a fixeket kapja, mint a mérés
  const navSessionRef = useRef<NavigationSession | null>(null);
  const onFix = useCallback(
    (fix: GpsFix) => {
      session.onFix(fix);
      navSessionRef.current?.onFix(fix);
      setTileFix(fix);
    },
    [session.onFix],
  );
  const places = usePlaces();
  const navSim = useMemo<NavSimData | null>(() => (NAV_SIM ? buildNavSim(Date.now(), { traffic: NAV_SIM_OPTS.traffic }) : null), []);
  const navFetch = useMemo(() => (navSim ? simRouteFetcher(navSim, NAV_SIM_ALT, NAV_SIM_OPTS) : (directionsClient?.routes ?? null)), [navSim]);
  const loadData = useCallback(
    async (routes: readonly NavRoute[]): Promise<EnforcementData> =>
      navSim ? { sections: [...BUNDLED_SECTIONS, navSim.section], cameras: [...BUNDLED_CAMERAS, navSim.camera], planned: [] } : loadRouteData(routes),
    [navSim],
  );
  const nav = useNavigation(
    { fix: view.lastFix, fetchRoutes: navFetch, loadData, now, unit: settings.egyseg, voice: settings.hangos_utasitasok, lang, simMode: SIM_MODE, greeting: settings.megszolitas },
    places,
  );
  navSessionRef.current = nav.session;
  const navSearch = useCallback((q: string) => (NAV_SIM ? simSearch(q) : searchPlaces(q, view.lastFix)), [view.lastFix]);
  const requestsToday = useSyncExternalStore(requestCounter.subscribe, () => requestCounter.count);

  // GPS (valódi mód) + másodpercenkénti frissítés (alagútban a becslés miatt)
  // AW15: ha a pill koppintására indított kérést a böngésző PERMISSION_DENIED-del utasítja el, a tiltott-lap nyílik
  const geoloc = useGeolocation(!SIM_MODE, onFix, () => setSheet('geo'));
  const geo = geoloc.status;
  // AW13: a GPS-pill koppintása – engedélykérés / tiltott-lap a bekapcsolás útjával / semmi
  const gpsAction = SIM_MODE ? 'none' : gpsPillAction(geoloc.permission, geo);
  const browser = useMemo(() => detectBrowser(navigator.userAgent, navigator.maxTouchPoints), []);
  useEffect(() => {
    if (SIM_MODE) return;
    const id = setInterval(() => {
      session.tick();
      navSessionRef.current?.tick();
    }, 1000);
    return () => clearInterval(id);
  }, [session.tick]);

  // Háttérbe kerülés: a mérés tisztán megszakad (nincs GPS a háttérben → nem becsülünk tovább).
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && session.interrupt();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', session.interrupt);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', session.interrupt);
    };
  }, [session.interrupt]);

  const wake = useWakeLock(true);

  // térkép
  const lightPreset = useLightPreset(view.lastFix, SUN_AT === null ? now : sunAtNow);
  const tone = toneOf(view);
  const highlightId = view.phase === 'meres' || view.phase === 'kozeledik' ? (view.section?.id ?? null) : null;
  // AW16: napközben a kinézet dönt (Világos = day, Színes = dusk); napnyugtakor és éjjel mindkettő a napszaké
  const appliedPreset = mapLightPreset(settings.terkep, lightPreset);
  useEffect(() => map.setLightPreset(appliedPreset), [map, appliedPreset]);
  useEffect(() => {
    document.documentElement.dataset.look = strongGlassFor(settings.terkep, appliedPreset) ? 'vilagos' : 'normal';
  }, [settings.terkep, appliedPreset]);
  useEffect(() => map.setLook(settings.terkep), [map, settings.terkep]);
  useEffect(() => map.showSections(all, highlightId), [map, all, highlightId]);
  useEffect(() => map.setPosition(view.lastFix), [map, view.lastFix]);
  useEffect(
    () => map.setProgress(view.phase === 'meres' ? view.progress : null, statusColor[tone as keyof typeof statusColor] ?? statusColor.kezi),
    [map, view.phase, view.progress, tone],
  );
  // követő kamera: a térkép mozgatása kikapcsolja; mérés közben 5 s után magától visszaáll
  const measuring = view.phase === 'meres' || view.phase === 'kezi';
  const follow = useFollow(map, measuring);

  // a „Túl gyors” állapotot a navigáció is bemondja
  useEffect(() => nav.session?.setMeasureStatus(view.phase === 'meres' ? view.status : null), [nav.session, view.phase, view.status]);
  useEffect(() => nav.session?.setMeasuring(measuring), [nav.session, measuring]);

  // AW12: navigáció közben a követő kamera a sebességhez kötött zoommal, gyors irány-követéssel
  const navFollowOn = nav.view !== null && nav.view.phase === 'navigating';
  useEffect(() => map.setNavFollow(navFollowOn), [map, navFollowOn]);
  // közeli kamera: egy rezgés kameránként (hang nélküli módban is; ahol a böngésző támogatja)
  const nearCamId = nav.view?.cameraNear?.item.id ?? null;
  // AW17: a szimulátorban a jelenlegi útvonal azonosítója a böngészős ellenőrzésnek (auto-váltás)
  const navRouteId = nav.view?.route.id ?? null;
  useEffect(() => {
    if (SIM_MODE) (window as unknown as { __navRouteId?: string | null }).__navRouteId = navRouteId;
  }, [navRouteId]);
  useEffect(() => {
    if (!nearCamId) return;
    if (SIM_MODE) {
      const w = window as unknown as { __navVibrate?: string[] };
      (w.__navVibrate ??= []).push(nearCamId);
    }
    navigator.vibrate?.(200);
  }, [nearCamId]);

  // tervezett útvonalak és a cél a térképen; navigáció közben csak a jelenlegi útvonal
  // az alternatívákon címke (A8d): menetidő-különbség a kiválasztotthoz képest; AW17: a saját szakasz legtávolabbi pontjánál
  const routesShown = useMemo<{ routes: MapRoute[]; dest: LatLon | null }>(() => {
    const toMap = (r: NavRoute, selected: boolean, label: MapRoute['label'] = null): MapRoute => ({ id: r.id, selected, runs: congestionRuns(r), label });
    // megérkezve az útvonal maradéka (pl. az útra illesztett végpontig tartó csonk) már nem látszik, csak a cél jelölője
    if (nav.view) return { routes: nav.view.phase === 'arrived' ? [] : [toMap(nav.view.route, true)], dest: nav.view.destination };
    if (nav.plan?.status === 'ready') {
      const { routes, selected } = nav.plan;
      const labels = altLabels(routes, nav.summaries.map((x) => x.durationS), selected);
      const labelOf = (i: number): MapRoute['label'] => {
        const l = labels.find((x) => x.index === i);
        return l ? { at: l.at, text: l.text, aria: t('nav.alt.aria', { d: l.text }), own: l.own, divergence: l.divergence, basePath: l.basePath, altPath: l.altPath } : null;
      };
      return { routes: routes.map((r, i) => toMap(r, i === selected, labelOf(i))), dest: nav.plan.dest };
    }
    return { routes: [], dest: null };
  }, [nav.view?.route, nav.view?.destination, nav.view?.phase, nav.plan, nav.summaries, lang]);
  useEffect(() => map.showRoutes(routesShown.routes, routesShown.dest), [map, routesShown]);
  const planRoutes = nav.plan?.status === 'ready' ? nav.plan.routes : null;
  useEffect(() => {
    if (planRoutes) map.fitRoute({ points: planRoutes.flatMap((r) => r.points.filter((_, i) => i % 8 === 0)), padTop: 120, padBottom: 400 });
  }, [map, planRoutes]);
  // a tervezés vége (indítás vagy mégse): a kamera visszaáll a követésre
  const planOpen = nav.plan !== null;
  const wasPlanOpen = useRef(false);
  useEffect(() => {
    if (wasPlanOpen.current && !planOpen) {
      map.fitRoute(null);
      map.followUser(true);
      follow.recenter();
    }
    wasPlanOpen.current = planOpen;
  }, [map, planOpen]);

  // szimulátor: ?navsim&stage=picker|nav – a keresés átugrásával a kiválasztott állapotba
  const stage = useMemo(() => new URLSearchParams(location.search).get('stage'), []);
  useEffect(() => {
    if (NAV_SIM && stage && view.lastFix && !nav.plan && !nav.view) nav.planTo(SIM_PLACES[0]!);
  }, [view.lastFix === null]);
  useEffect(() => {
    if (NAV_SIM && stage === 'nav' && nav.plan?.status === 'ready') nav.start();
  }, [nav.plan?.status]);

  // bejelentések a térképen (szimulátorban a minta-bejelentések a szerver helyett)
  const [simReps, setSimReps] = useState<ActiveReport[]>([]);
  const simRepsRef = useRef(simReps);
  simRepsRef.current = simReps;
  const fetchReports = useMemo(() => (SIM_MODE ? async () => simRepsRef.current : fetchServerReports), []);
  const feed = useReports(map, view.lastFix, fetchReports, now);
  const { reload: reloadReports } = feed;
  useEffect(() => {
    if (simReps.length) reloadReports();
  }, [simReps, reloadReports]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // AOS14: közeledő bejelentés – EGY kártya a kamera-figyelmeztetés helyén: figyelmeztetés, 200 m-en belül helyben
  // „Még ott van?” (bejelentésenként egyszer; válasz, elhaladás vagy 10 s után eltűnik)
  const [promptWatch] = useState(() => new ReportPromptWatch());
  const [prompt, setPrompt] = useState<ReportPrompt | null>(null);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const fixRef = useRef(view.lastFix);
  fixRef.current = view.lastFix;
  const checkPrompt = useCallback(() => {
    const f = feedRef.current;
    const p = promptWatch.update(fixRef.current, f.reports, (rid) => f.myVote(rid) !== null, now());
    // a távolság 10 m-es lépésben frissül (nem minden óra-lépésnél új objektum)
    setPrompt((prev) => (prev?.id === p?.id && prev?.phase === p?.phase && Math.round((prev?.distanceM ?? 0) / 10) === Math.round((p?.distanceM ?? 0) / 10) ? prev : p));
  }, [promptWatch, now]);
  useEffect(checkPrompt, [view.lastFix, feed.reports.length, checkPrompt]);
  useEffect(() => {
    const id = setInterval(checkPrompt, 1000);
    return () => clearInterval(id);
  }, [checkPrompt]);
  const closePrompt = useCallback(() => {
    promptWatch.close();
    setPrompt(null);
  }, [promptWatch]);
  const prompted = prompt ? (feed.reports.find((r) => r.id === prompt.id) ?? null) : null;
  const selected = feed.reports.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId || !measuring) return;
    const id = setTimeout(() => setSelectedId(null), REPORT_CARD_AUTOCLOSE_MS);
    return () => clearTimeout(id);
  }, [selectedId, measuring]);
  const pinsKey = feed.reports.map((r) => `${r.id}:${r.type}:${r.gateKind}`).join('|');
  const pins = useMemo<MapReport[]>(
    () => feed.reports.map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, ...reportVisual(r) })),
    // csak ha a halmaz (vagy a nyelv – a felirat) változik; a lista minden frissítésnél új tömb
    [pinsKey, lang],
  );
  const highlighted = selected?.id ?? prompted?.id ?? null;
  useEffect(() => map.showReports(pins, highlighted), [map, pins, highlighted]);

  // fix kamerák (A7): a beépített lista + szerver (szimulátorban a minta-kamerák is), a környéken
  const [simCams, setSimCams] = useState<FixedCamera[]>([]);
  const serverCameras = useTileItems(SIM_MODE || !supabase ? null : cameraCache, tileFix, BUNDLED_CAMERAS);
  const cameras = useMemo(() => (SIM_MODE ? [...BUNDLED_CAMERAS, ...simCams] : serverCameras), [simCams, serverCameras]);
  // a körzet csak ~1 km-es elmozdulásonként számolódik újra
  const camAnchor = view.lastFix ? `${view.lastFix.lat.toFixed(2)}:${view.lastFix.lon.toFixed(2)}` : null;
  const nearCameras = useMemo(() => {
    const f = view.lastFix;
    return f ? cameras.filter((c) => haversineM(f, c) <= CAMERA_RADIUS_M) : [];
  }, [cameras, camAnchor]);
  const camLayer = useMemo(() => visibleCameras(nearCameras), [nearCameras]);
  const [selectedCamId, setSelectedCamId] = useState<string | null>(null);
  const selectedCam = camLayer.points.find((c) => c.id === selectedCamId) ?? null;
  useEffect(
    () =>
      map.showCameras(
        // az útvonalválasztó látványában a kamera-ikonok csak zsúfolnának
        (nav.plan ? [] : camLayer.points).map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, icon: cameraIcon(c.type), label: cameraLabel(c.type) })),
        camLayer.zones,
        selectedCam?.id ?? null,
      ),
    [map, camLayer, selectedCam?.id, lang, nav.plan !== null],
  );
  useEffect(
    () =>
      map.setHandlers({
        onReportTap: (id) => {
          setSelectedId(id);
          setSelectedCamId(null);
        },
        onCameraTap: (id) => {
          setSelectedCamId(id);
          setSelectedId(null);
        },
        onRouteTap: nav.selectRouteById,
      }),
    [map, nav.selectRouteById],
  );
  useEffect(() => {
    if (!selectedCamId || !measuring) return;
    const id = setTimeout(() => setSelectedCamId(null), REPORT_CARD_AUTOCLOSE_MS);
    return () => clearTimeout(id);
  }, [selectedCamId, measuring]);

  // tervezett mérések (A7): halvány sárga vonal; a vonalon haladva felül sáv
  const [simPlanned, setSimPlanned] = useState<PlannedCheck[]>([]);
  const serverPlanned = useTileItems(SIM_MODE || !supabase ? null : plannedCache, tileFix, NO_PLANNED);
  const plannedAll = SIM_MODE ? simPlanned : serverPlanned;
  const fixT = view.lastFix?.timestamp ?? 0;
  const plannedShown = useMemo(
    () => (settings.tervezett_meresek ? plannedAll.filter((c) => plannedCheckActive(c, now())) : NO_PLANNED),
    // a lejárat percenként (a fixek idejéből) elég pontos
    [plannedAll, settings.tervezett_meresek, Math.floor(fixT / 60_000)],
  );
  const plannedWatch = useRef(new PlannedCheckWatch());
  const [activePlanned, setActivePlanned] = useState<PlannedCheck | null>(null);
  useEffect(() => setActivePlanned(plannedWatch.current.update(view.lastFix, plannedShown, now())), [view.lastFix, plannedShown, now]);
  useEffect(
    () =>
      map.showPlannedChecks(
        // `zone` láthatóságnál a vonal nem kerül a térképre (csak a sáv jelez)
        plannedShown.filter((c) => cameraVisibility(c.country) === 'show').map((c) => ({ id: c.id, lines: c.lines, zones: c.zones })),
        activePlanned?.id ?? null,
      ),
    [map, plannedShown, activePlanned?.id],
  );

  // AW15: navigáció közben a kézi mérés kártyája kis pillé zsugorodik – 5 s után, bökésre, vagy ha a navigációnak hely
  // kell (közeli manőver, ajánlat, közeli kamera); bökésre újra teljes. Pill alatt a navigáció úgy látszik, mint mérés nélkül.
  const pillActive = nav.view !== null && view.phase === 'kezi';
  const navSpace =
    nav.view !== null &&
    navNeedsSpace({ maneuverM: nav.view.phase === 'arrived' ? null : nav.view.next.distanceM, offer: nav.view.offer !== null, cameraNear: nav.view.cameraNear !== null });
  const [pill, setPill] = useState<ManualPillState | null>(null);
  const pillInput = useRef({ active: pillActive, space: navSpace });
  pillInput.current = { active: pillActive, space: navSpace };
  useEffect(() => setPill((s) => manualPillTick(s, pillActive, navSpace, now())), [pillActive, navSpace, view.lastFix, now]);
  useEffect(() => {
    if (!pillActive) return;
    const id = setInterval(() => setPill((s) => manualPillTick(s, pillInput.current.active, pillInput.current.space, now())), 250);
    return () => clearInterval(id);
  }, [pillActive, now]);
  const pillCollapsed = pillActive && pill?.collapsed === true;
  const tapPill = useCallback(() => setPill((s) => s && manualPillTap(s, now())), [now]);
  // az elrendezés szerinti mérés: a pillé zsugorodott kézi mérés nem foglalja a helyet
  const measuringLayout = measuring && !pillCollapsed;
  // AW17: navigáció közben az alsó sáv MINDIG a képernyő alján; a mérőkártya (és minden más kártya) fölötte, soha nem
  // alatta és nem helyette. Szakasz nélkül (vagy a zsugorított kézi mérésnél) csak a sáv látszik.
  const navBottomShown = nav.view !== null;
  const meterCompact = navMeterCompact(view.phase, nav.view?.offer != null);
  const hudCardShown = !(nav.view !== null && (view.phase === 'nincs_szakasz' || pillCollapsed));

  // AOS13: a felső lépés-kártya egysoros sávvá zsugorodik, ha a teljes kártya az alsó csoport alá érne (mérés közben
  // mindig). A rejtett kártyát is mérjük, az alsó csoport tetejét pedig a sáv nélkül – így a kettő nem kapcsolgat
  // oda-vissza. Elrendezés szerint (offset*), mert a megjelenési animáció transzformja a látszó helyet még torzítja.
  const [stepStrip, setStepStrip] = useState(false);
  useLayoutEffect(() => {
    const hud = hudRef.current;
    const card = document.querySelector<HTMLElement>('.nav-top');
    let bottomTop: number | null = null;
    if (hud) {
      const float = hud.querySelector<HTMLElement>('.hud-float');
      const strip = hud.querySelector<HTMLElement>('.nav-strip');
      bottomTop =
        window.innerHeight - hud.offsetHeight - (float && float.offsetHeight > 0 ? float.offsetHeight + 12 : 0) + (strip ? strip.offsetHeight + 12 : 0);
    }
    setStepStrip(navStepStrip({ measuring: measuringLayout, cardBottom: card ? card.offsetTop + card.offsetHeight : null, bottomTop, gap: 12 }));
  });

  // az autó a HUD feletti szabad terület ~60%-ánál, navigáció közben az alsó harmadban (az út előre látszik) –
  // a kártya magasságát mérjük, nem becsüljük
  const hudRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = hudRef.current;
    if (!el) return;
    let prevH: number | null = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const h = window.innerHeight;
      const top = h - el.offsetHeight;
      // navigációban a legfelső alsó kártyához mérünk (AW17: a mérőkártya az alsó sáv fölött; nélküle az alsó sáv): a
      // tábla és a gombok a szélén vannak, középen a térkép látszik; elrendezés szerint (offsetTop), mert a FLIP-animáció
      // transzformja alatt a látszó hely még a régi
      const card = el.querySelector<HTMLElement>(':scope > .card');
      const cardTop = card ? top + card.offsetTop : top;
      map.setFocusY(
        navFollowOn
          ? Math.max(0.18, Math.min(NAV_FOLLOW.focusY, (cardTop - NAV_FOLLOW.focusGapPx) / h))
          : Math.min(0.5, Math.max(0.18, (top * 0.6) / h)),
      );
      // kompakt ↔ nagy kártya: a gombsor és a kártya a régi helyéről csúszik az újra (FLIP)
      const delta = prevH === null ? 0 : el.offsetHeight - prevH;
      prevH = el.offsetHeight;
      if (Math.abs(delta) < 24 || reduced.matches) return;
      for (const c of el.children) {
        if (c.classList.contains('slowdown')) continue;
        c.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [map, navFollowOn]);

  // lapok, visszajelzés
  const [sheet, setSheet] = useState<'report' | 'settings' | 'geo' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.ms ?? 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // Egyszeri figyelmeztetés országonként (DE: a vezető nem használhatja a kamera-funkciót) – eszközönként egyszer.
  const countriesKey = [...new Set([...nearCameras, ...plannedShown].map((c) => c.country))].sort().join(',');
  const warnedCountries = useRef(new Set<string>());
  useEffect(() => {
    for (const country of countriesKey ? countriesKey.split(',') : []) {
      const text = cameraWarning(country);
      if (!text || warnedCountries.current.has(country)) continue;
      warnedCountries.current.add(country);
      const key = `figyelmeztetes:${country}`;
      try {
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, '1');
      } catch {
        // tárhely nélkül munkamenetenként egyszer
      }
      showToast({ text, tone: 'hataron', icon: 'report', ms: 6000 });
    }
  }, [countriesKey, showToast]);

  // Ébrentartás: egyetlen, csendes figyelmeztetés induláskor (ha nem sikerült), utána csak az ikon.
  const wakeWarned = useRef(false);
  const wakeStatus = useRef(wake.status);
  wakeStatus.current = wake.status;
  useEffect(() => {
    const id = setTimeout(() => {
      if (wakeWarned.current || wakeStatus.current === 'aktiv') return;
      wakeWarned.current = true;
      showToast({ text: t('toast.wakeSleep'), tone: 'semleges', icon: 'screen', ms: 5000 });
    }, 2500);
    return () => clearTimeout(id);
  }, [showToast]);

  // AW16: a kézi mérés privát – nem küld semmit a szerverre (a kapukat a Bejelentés menü „Átlagmérés eleje / vége” adja)
  const startManual = useCallback(() => {
    session.startManual();
  }, [session.startManual]);

  const stopManual = useCallback(() => {
    session.stopManual();
  }, [session.stopManual]);

  // AOS14 javítás: „Átlagmérés eleje / vége” egy tétel – elküldött eleje után „vége”, a mérés / navigáció végén vissza
  const [gateStarted, setGateStarted] = useState(false);
  const activeRef = useRef({ measuring: false, nav: false });
  useEffect(() => {
    const now = { measuring: view.phase === 'meres' || view.phase === 'kezi', nav: nav.view !== null };
    const was = activeRef.current;
    if ((was.measuring && !now.measuring) || (was.nav && !now.nav)) setGateStarted((g) => gateStartedAfter(g, 'activityEnded'));
    activeRef.current = now;
  }, [view.phase, nav.view !== null]);

  const [sending, setSending] = useState<ReportChoice | null>(null);
  const report = useCallback(
    (choice: ReportChoice, opts: { jamSample?: boolean } = {}) => {
      const row = view.lastFix ? reportFromFix(choice, view.lastFix) : null;
      if (!row) return;
      const label = reportChoiceLabel(choice);
      setSending(choice);
      createReports(supabase, [row])
        .then(([id]) => {
          if (id) feed.addOwn(ownReport(row, id, now()));
          // AW18: a „Dugó” / „Beállt” bejelentés közösségi dugó-mintát is ad (a kártya „Igen”-jénél az `answerJam` adja)
          if (isJamReport(choice) && opts.jamSample !== false) nav.session?.reportedJam();
          setGateStarted((g) => gateStartedAfter(g, { sent: choice }));
          showToast({ text: t('report.sent', { label }), tone: 'jo', icon: 'check' });
        })
        .catch(() => showToast({ text: t('report.sendFail'), tone: 'tul', icon: 'report' }))
        .finally(() => {
          setSending(null);
          setSheet(null);
        });
    },
    [view.lastFix, showToast, feed.addOwn, now, nav.session],
  );

  // AW18: „Dugóba kerültél?” – Igen: „Dugó” bejelentés a pozícióra (a meglévő folyamattal), Nem: erre a szakaszra nem kérdez újra
  const jamAsk: JamAskProps | null =
    nav.view?.jamAsk && nav.view.phase === 'navigating'
      ? {
          sending: sending !== null,
          onAnswer: (yes) => {
            nav.session?.answerJam(yes);
            if (yes) report('dugo', { jamSample: false });
          },
        }
      : null;

  // AW18: a közösségi dugó-minták feltöltése (szimulátorban csak napló: window.__navJam)
  useEffect(() => {
    const s = nav.session;
    if (!s) return;
    const pump = () => {
      const rows = s.drainJamSamples();
      if (rows.length === 0) return;
      if (SIM_MODE) {
        const w = window as unknown as { __navJam?: unknown[] };
        (w.__navJam ??= []).push(...rows);
        return;
      }
      createJamSamples(supabase, rows).catch((e: unknown) => console.warn('[nav] jam_samples insert failed', e));
    };
    pump();
    return s.subscribe(pump);
  }, [nav.session]);
  // AW18: mások friss dugó-mintái az útvonal előttünk lévő részén, percenként (szimulátorban nincs)
  useEffect(() => {
    const s = nav.session;
    if (!s || SIM_MODE || !supabase) return;
    const load = () => {
      const v = s.view();
      Promise.all([listActiveJams(supabase, jamQueryBBox(v.route, v.alongM)), currentUserId(supabase)])
        .then(([rows, uid]) => s.setCommunityJams(rows.map((r) => rowToCommunityJam(r, uid))))
        .catch((e: unknown) => console.warn('[nav] active_jams fetch failed', e));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [nav.session]);

  // megerősítés / nincs ott (report_votes); szimulátorban csak helyben
  const [voting, setVoting] = useState(false);
  const vote = useCallback(
    (id: string, confirm: boolean) => {
      const done = () => {
        feed.vote(id, confirm);
        showToast({ text: t(confirm ? 'vote.confirmed' : 'vote.gone'), tone: 'jo', icon: 'check' });
        setSelectedId(null);
        if (promptWatch.current === id) closePrompt();
      };
      if (SIM_MODE) return done();
      setVoting(true);
      voteReport(supabase, id, confirm)
        .then(done)
        .catch(() => showToast({ text: t('report.sendFail'), tone: 'tul', icon: 'report' }))
        .finally(() => setVoting(false));
    },
    [feed.vote, showToast, promptWatch, closePrompt],
  );

  const reportAlert: ReportAlertProps | null =
    prompt && prompted ? { prompt, report: prompted, canVote: SIM_MODE || supabase !== null, sending: voting, onVote: (c) => vote(prompted.id, c) } : null;

  const driving = view.phase === 'meres' || view.phase === 'kozeledik' || view.phase === 'kezi';
  // a bal alsó sebességhatár-tábla: mérés / közeledés közben a mérőkártya saját táblája szól
  const navSign = nav.view !== null && (view.phase === 'nincs_szakasz' || view.phase === 'befejezve' || view.phase === 'megszakadt' || view.phase === 'kezi_eredmeny' || pillCollapsed);
  const accuracy = view.lastFix?.accuracy ?? null;

  return (
    <>
      <StatusPills
        onSearch={nav.view || driving || view.phase === 'kezi_eredmeny' ? undefined : () => nav.openSearch()}
        greeting={reportAlert ? undefined : greetingText(settings.megszolitas)}
        geo={SIM_MODE ? 'aktiv' : geo}
        accuracy={accuracy}
        wake={wake.status}
        offline={!SIM_MODE && (sectionsStatus === 'offline' || !supabase)}
        simMode={SIM_MODE && SIM_PANEL}
        compact={driving || nav.view !== null}
        gpsAction={gpsAction}
        onGps={() => (gpsAction === 'deniedHelp' ? setSheet('geo') : geoloc.request(true))}
        onWake={() => {
          if (wake.status === 'nem_tamogatott')
            showToast({ text: t('toast.wakeNever'), tone: 'hataron', icon: 'screen' });
          else wake.request();
        }}
      />
      {NAV_SIM && navSim && <NavSimDriver data={navSim} active={nav.session !== null} onFix={onFix} onTick={session.tick} clock={clock} onSection={setSimSection} onCameras={setSimCams} onReports={setSimReps} />}
      {SIM_MODE && !NAV_SIM && (
        <SimDriver
          onFix={onFix}
          onTick={session.tick}
          clock={clock}
          onSection={setSimSection}
          onReports={setSimReps}
          onCameras={setSimCams}
          onPlanned={setSimPlanned}
          onBackground={session.interrupt}
        />
      )}
      {nav.view && !measuringLayout && (
        <NavTop view={nav.view} unit={settings.egyseg} hidden={stepStrip} report={reportAlert} jam={jamAsk} onRetryReroute={() => nav.session?.retryReroute()} />
      )}
      {/* AOS14: navigáció nélkül, vagy ha a felső kártya nem látszik, a bejelentés kártyája önállóan, ugyanott (AW18: a dugó-kérdés előbb) */}
      {jamAsk && !(nav.view && !measuringLayout && !stepStrip) && <JamAskCard ask={jamAsk} />}
      {reportAlert && !jamAsk && !(nav.view && !measuringLayout && !stepStrip) && <ReportAlertCard alert={reportAlert} unit={settings.egyseg} />}
      <PlannedBand check={activePlanned} compact={measuring} />

      <div className="hud" ref={hudRef} data-hidden={nav.plan !== null || nav.searchFor !== null}>
        {/* AW17-javítás: egysoros mérőkártyánál (mérés + ajánlat) nincs külön sáv – a max érték a kártyában */}
        {view.phase === 'meres' && slowDownBarShown(meterCompact) && <SlowDown view={view} unit={settings.egyseg} />}
        {/* a HUD fölött lebeg (nem változtat a magasságán → a kamera nem ugrik); mérésnél a Lassíts-sáv fölött */}
        <div className="hud-float" data-raised={view.phase === 'meres'}>
          {nav.view?.offer && <OfferCard offer={nav.view.offer} onAccept={() => nav.session?.acceptOffer()} onDecline={() => nav.session?.declineOffer()} />}
          {selected && (
            <ReportCard
              key={selected.id}
              report={selected}
              now={now()}
              canVote={SIM_MODE || supabase !== null}
              voted={feed.myVote(selected.id)}
              sending={voting}
              onVote={(c) => vote(selected.id, c)}
              onClose={() => setSelectedId(null)}
            />
          )}
          {!selected && selectedCam && <CameraCard key={selectedCam.id} camera={selectedCam} onClose={() => setSelectedCamId(null)} />}
          {(!follow.following || navSign) && (
            <div className="recenter-row">
              {navSign && nav.view && (
                <div className="sign-slot">
                  <LimitSign kmh={nav.view.limitKmh} unit={settings.egyseg} small />
                </div>
              )}
              {!follow.following && (
                <button className="round-btn glass recenter" onClick={follow.recenter} aria-label={t('map.recenter')}>
                  <Icon name="crosshair" size={28} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="actions">
          {pillCollapsed && <ManualMini view={view} unit={settings.egyseg} onExpand={tapPill} />}
          {!driving && view.phase !== 'kezi_eredmeny' && (
            <>
              <button className="round-btn glass" onClick={() => setSheet('settings')} aria-label={t('map.settings')}>
                <Icon name="sliders" size={26} />
              </button>
              <button className="round-btn glass" onClick={startManual} aria-label={t('map.manualStart')}>
                <Icon name="stopwatch" size={26} />
              </button>
            </>
          )}
          <button className="round-btn glass report" onClick={() => setSheet('report')} aria-label={t('map.report')}>
            <Icon name="report" size={28} />
          </button>
        </div>
        {nav.view && (measuringLayout || stepStrip) && <NavStrip view={nav.view} unit={settings.egyseg} />}
        {hudCardShown && (
          <Hud
            key={phaseKey(view)}
            view={view}
            settings={settings}
            gpsReady={view.lastFix !== null}
            navCompact={navResultCompact(view.phase, nav.view !== null)}
            meterCompact={meterCompact}
            onCollapseManual={pillActive ? tapPill : undefined}
            onStopManual={stopManual}
            onDismiss={session.dismiss}
          />
        )}
        {nav.view && navBottomShown && (
          <NavBottom
            view={nav.view}
            unit={settings.egyseg}
            currentKmh={view.currentKmh}
            showSpeed={navBottomShowsSpeed(view.phase)}
            over={navSpeedOver(view.currentKmh, nav.view.limitKmh)}
            onEnd={nav.end}
          />
        )}
      </div>

      {toast && (
        <div key={toast.id} className="toast glass" data-tone={toast.tone} role="status">
          <Icon name={toast.icon} size={22} /> {toast.text}
        </div>
      )}

      {nav.searchFor && (
        <SearchScreen kind={nav.searchFor} recents={places.recents} saved={places.saved} search={navSearch} onPick={nav.choose} onClose={nav.closeSearch} />
      )}
      {nav.plan && (
        <RoutePicker
          plan={nav.plan}
          summaries={nav.summaries}
          fastest={nav.fastest}
          unit={settings.egyseg}
          now={now()}
          onSelect={nav.selectRoute}
          onStart={nav.start}
          onRetry={nav.retryPlan}
          onClose={nav.cancelPlan}
        />
      )}

      {sheet === 'geo' && (
        <GeoBlockedSheet
          browser={browser}
          onRetry={() => {
            geoloc.request();
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'report' && (
        <ReportSheet
          fix={view.lastFix}
          online={supabase !== null}
          sending={sending}
          gateStarted={gateStarted}
          onPick={report}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          settings={settings}
          update={update}
          simMode={SIM_MODE}
          saved={places.saved}
          // AW15: a kereső a Beállítások fölött nyílik; választás (vagy bezárás) után a lap ugyanott, nyitva marad
          onPickPlace={(kind) => nav.openSearch(kind)}
          onClearPlace={(kind) => places.setSaved(kind, null)}
          onRemoveOther={places.removeOther}
          onClose={() => setSheet(null)}
          info={{
            gps: t(SIM_MODE ? 'geo.sim' : GEO_TEXT[geo]),
            wake: t({ aktiv: 'wakeinfo.active', inaktiv: 'wakeinfo.inactive', nem_tamogatott: 'wakeinfo.unsupported' }[wake.status] as TKey),
            sections: t('sections.count', {
              n: all.length,
              status: t(
                { beepitett: 'sections.status.bundled', betoltes: 'sections.status.loading', szerver: 'sections.status.server', offline_cache: 'sections.status.cache', offline: 'sections.status.offline' }[
                  sectionsStatus
                ] as TKey,
              ),
            }),
            server: t(supabase ? 'server.set' : 'server.none'),
            requests: String(requestsToday),
          }}
        />
      )}
    </>
  );
}

/** A kártya újra-animálódik állapotváltáskor, de nem minden frissítésnél. */
const phaseKey = (v: SessionView) => `${v.phase}:${v.section?.id ?? ''}`;

/** A szimulátor bekötése: óra, extra (teszt)szakasz, lejátszás. */
function SimDriver({
  onFix,
  onTick,
  clock,
  onSection,
  onReports,
  onCameras,
  onPlanned,
  onBackground,
}: {
  onFix: (f: GpsFix) => void;
  onTick: () => void;
  clock: { current: () => number };
  onSection: (s: Section) => void;
  onReports: (r: ActiveReport[]) => void;
  onCameras: (c: FixedCamera[]) => void;
  onPlanned: (p: PlannedCheck[]) => void;
  onBackground: () => void;
}) {
  const sim = useSimulator(BUNDLED_SECTIONS, { onFix, onTick }, useMemo(() => simStartFromUrl(location.search), []));
  // az óra és a teszt-szakasz még a lejátszás (és a seek) előtt beáll
  useLayoutEffect(() => {
    clock.current = sim.now;
    onSection(sim.section);
  }, [clock, sim.now, onSection, sim.section]);
  useEffect(() => onReports(simReports(sim.simulation)), [onReports, sim.simulation]);
  useEffect(() => {
    onCameras(simCameras(sim.simulation, sim.scenario));
    onPlanned(simPlannedChecks(sim.simulation, sim.scenario));
  }, [onCameras, onPlanned, sim.simulation, sim.scenario]);
  return SIM_PANEL ? <SimPanel sim={sim} onBackground={onBackground} /> : null;
}

/** A navigációs szimulátor bejátszása: indulás előtt egy álló fix, indítás után a fixtúra-útvonal (letéréssel, szakasszal, kamerával). */
function NavSimDriver({
  data,
  active,
  onFix,
  onTick,
  clock,
  onSection,
  onCameras,
  onReports,
}: {
  data: NavSimData;
  active: boolean;
  onFix: (f: GpsFix) => void;
  onTick: () => void;
  clock: { current: () => number };
  onSection: (s: Section) => void;
  onCameras: (c: FixedCamera[]) => void;
  onReports: (r: ActiveReport[]) => void;
}) {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const speed = Math.max(1, Number(q.get('speed')) || 12);
  const seek = Math.min(1, Math.max(0, Number(q.get('seek')) || 0));
  useLayoutEffect(() => {
    onSection(data.section);
    onCameras([data.camera]);
    onReports(data.reports);
    // a képernyőkép-szkript innen tudja, hol vannak az ablakok (mintaindexek)
    (window as unknown as { __navSim?: unknown }).__navSim = { windows: data.windows, length: data.samples.length };
  }, [data, onSection, onCameras, onReports]);
  // indulás előtt: állva a kiindulópontnál
  useEffect(() => {
    onFix(simIdleFix());
  }, [onFix]);
  useEffect(() => {
    if (!active) return;
    const { samples, windows } = data;
    // a seek az ablak elejéről játssza le gyorsan, hogy a mérés belépése is megtörténjen
    const at = Number(q.get('at')) || 0;
    const target = at > 0 ? at : Math.floor(seek * samples.length);
    let i = [...windows].reverse().find((w) => w <= target) ?? 0;
    const base = Date.now() - samples[i]!.t;
    const play = (k: number) => {
      const s = samples[k]!;
      clock.current = () => s.t + base;
      if (s.dropped) onTick();
      else onFix({ ...s.fix, timestamp: s.fix.timestamp + base });
    };
    for (; i < target; i++) play(i);
    const id = setInterval(() => {
      if (i >= samples.length) return clearInterval(id);
      play(i++);
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [active]);
  return null;
}
