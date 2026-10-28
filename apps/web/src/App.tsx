import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CAMERA_LABEL,
  cameraVisibility,
  cameraWarning,
  createReports,
  currentUserId,
  listActiveReports,
  mergeById,
  ownReport,
  plannedCheckActive,
  PlannedCheckWatch,
  reportVisual,
  rowToActiveReport,
  visibleCameras,
  voteReport,
  type ActiveReport,
  type FixedCamera,
  type PlannedCheck,
  type BBox,
  REPORT_CHOICES,
  reportFromFix,
  tempSectionEndReports,
  type ReportChoice,
  type ReportInsert,
  type SessionView,
} from '@atlagsebesseg/app-logic';
import { BUNDLED_CAMERAS } from '@atlagsebesseg/app-logic/bundled-cameras';
import { BUNDLED_SECTIONS } from '@atlagsebesseg/app-logic/bundled-sections';
import { haversineM, type GpsFix, type Section } from '@atlagsebesseg/core';
import { statusColor } from '@atlagsebesseg/design-tokens';
import { cameraCache, plannedCache, supabase } from './backend';
import { useFollow } from './hooks/useFollow';
import { useGeolocation, type GeoStatus } from './hooks/useGeolocation';
import { useLightPreset } from './hooks/useLightPreset';
import { useReports } from './hooks/useReports';
import { useSections } from './hooks/useSections';
import { useSession } from './hooks/useSession';
import { useSettings } from './hooks/useSettings';
import { useTileItems } from './hooks/useTileItems';
import { useWakeLock } from './hooks/useWakeLock';
import { createWebMapAdapter, type MapReport, type WebMapAdapter } from './map';
import { simCameras, simPlannedChecks, simReports } from './sim/scenarios';
import { simStartFromUrl, useSimulator } from './sim/useSimulator';
import { CameraCard } from './ui/CameraCard';
import { cameraIcon } from './ui/cameraIcon';
import { Hud, SlowDown, toneOf, type GateReportState } from './ui/Hud';
import { Icon, type IconName } from './ui/Icon';
import { PlannedBand } from './ui/PlannedBand';
import { ReportCard } from './ui/ReportCard';
import { ReportSheet } from './ui/ReportSheet';
import { SettingsSheet } from './ui/SettingsSheet';
import { SimPanel } from './ui/SimPanel';
import { StartScreen } from './ui/StartScreen';
import { StatusPills } from './ui/StatusPills';

const SIM_MODE = new URLSearchParams(location.search).has('sim');
/** `?sim&panel=0`: a szimulátor vezérlője és jelzése nélkül (marketing-képernyőképekhez). */
const SIM_PANEL = new URLSearchParams(location.search).get('panel') !== '0';
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

const GEO_TEXT: Record<GeoStatus, string> = {
  ki: 'ki',
  kereses: 'keresés…',
  aktiv: 'aktív',
  elutasitva: 'tiltva (Beállítások → Safari → Hely)',
  nem_elerheto: 'nem elérhető (HTTPS kell)',
  hiba: 'hiba',
};

/** A vezetés közbeni képernyő: mérés-munkamenet + GPS vagy szimulátor + térkép + HUD. */
function Drive({ map }: { map: WebMapAdapter }) {
  const { settings, update } = useSettings();
  const clock = useRef<() => number>(Date.now);
  const now = useCallback(() => clock.current(), []);
  const [tileFix, setTileFix] = useState<GpsFix | null>(null);
  const [simSection, setSimSection] = useState<Section | null>(null);
  const { sections, status: sectionsStatus } = useSections(SIM_MODE ? null : tileFix);
  const all = useMemo(() => (simSection ? mergeById(sections, [simSection]) : sections), [sections, simSection]);
  const session = useSession(all, now);
  const { view } = session;

  const onFix = useCallback(
    (fix: GpsFix) => {
      session.onFix(fix);
      setTileFix(fix);
    },
    [session.onFix],
  );

  // GPS (valódi mód) + másodpercenkénti frissítés (alagútban a becslés miatt)
  const geo = useGeolocation(!SIM_MODE, onFix);
  useEffect(() => {
    if (SIM_MODE) return;
    const id = setInterval(session.tick, 1000);
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
  const lightPreset = useLightPreset(view.lastFix, now);
  const tone = toneOf(view);
  const highlightId = view.phase === 'meres' || view.phase === 'kozeledik' ? (view.section?.id ?? null) : null;
  useEffect(() => map.setLightPreset(lightPreset), [map, lightPreset]);
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
  const selected = feed.reports.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId || !measuring) return;
    const id = setTimeout(() => setSelectedId(null), REPORT_CARD_AUTOCLOSE_MS);
    return () => clearTimeout(id);
  }, [selectedId, measuring]);
  const pinsKey = feed.reports.map((r) => `${r.id}:${r.type}:${r.gateKind}`).join('|');
  const pins = useMemo<MapReport[]>(
    () => feed.reports.map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, ...reportVisual(r) })),
    // csak ha a halmaz változik (a lista minden frissítésnél új tömb)
    [pinsKey],
  );
  useEffect(() => map.showReports(pins, selected?.id ?? null), [map, pins, selected?.id]);

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
        camLayer.points.map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, icon: cameraIcon(c.type), label: CAMERA_LABEL[c.type] })),
        camLayer.zones,
        selectedCam?.id ?? null,
      ),
    [map, camLayer, selectedCam?.id],
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
      }),
    [map],
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
        plannedShown.filter((c) => cameraVisibility(c.country) === 'show').map((c) => ({ id: c.id, lines: c.lines })),
        activePlanned?.id ?? null,
      ),
    [map, plannedShown, activePlanned?.id],
  );

  // az autó a HUD feletti szabad terület ~60%-ánál – a kártya magasságát mérjük, nem becsüljük
  const hudRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = hudRef.current;
    if (!el) return;
    let prevH: number | null = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const h = window.innerHeight;
      const top = h - el.offsetHeight;
      map.setFocusY(Math.min(0.5, Math.max(0.18, (top * 0.6) / h)));
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
  }, [map]);

  // lapok, visszajelzés
  const [sheet, setSheet] = useState<'report' | 'settings' | null>(null);
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
      showToast({ text: 'A kijelző elalhat – állítsd az automatikus zárolást „Soha” értékre', tone: 'semleges', icon: 'screen', ms: 5000 });
    }, 2500);
    return () => clearTimeout(id);
  }, [showToast]);

  // Ideiglenes szakasz: kézi mérés + kezdő kapu induláskor, záró kapu a „Vége” gombra.
  const [temp, setTemp] = useState<{ startSent: boolean } | null>(null);
  const [gateState, setGateState] = useState<GateReportState>('nincs');
  const [gateRows, setGateRows] = useState<ReportInsert[] | null>(null);
  const sendGates = useCallback((rows: ReportInsert[]) => {
    setGateRows(rows);
    setGateState('kuldes');
    // toast is, mert közeledéskor a szakasz-kártya elfedi a kézi összegzést
    createReports(supabase, rows)
      .then((ids) => {
        ids.forEach((id, i) => rows[i] && feed.addOwn(ownReport(rows[i], id, now())));
        setGateState('elkuldve');
        showToast({ text: 'Ideiglenes szakasz bejelentve', tone: 'jo', icon: 'check' });
      })
      .catch(() => {
        setGateState('hiba');
        showToast({ text: 'A kapukat nem sikerült elküldeni', tone: 'tul', icon: 'report' });
      });
  }, [showToast, feed.addOwn, now]);
  useEffect(() => {
    if (view.phase === 'megszakadt') setTemp(null);
  }, [view.phase]);

  const startTempSection = useCallback(() => {
    const fix = view.lastFix;
    session.startManual();
    setGateState('nincs');
    setSheet(null);
    const start = fix ? reportFromFix('kapu_kezdo', fix) : null;
    if (!start) {
      // álló helyzetben még nincs irány: a kezdő kapu a mérés első pontjából, a végén megy el
      setTemp({ startSent: false });
      showToast({ text: 'Mérés indult – a kezdő kaput a végén küldjük', tone: 'kezi', icon: 'kapu_kezdo' });
      return;
    }
    setTemp({ startSent: false });
    createReports(supabase, [start])
      .then(([id]) => {
        if (id) feed.addOwn(ownReport(start, id, now()));
        setTemp((t) => t && { startSent: true });
        showToast({ text: 'Kezdő kapu bejelentve', tone: 'jo', icon: 'check' });
      })
      .catch(() => showToast({ text: 'A kezdő kaput a végén újra megpróbáljuk', tone: 'hataron', icon: 'kapu_kezdo' }));
  }, [view.lastFix, session.startManual, showToast, feed.addOwn, now]);

  const startManual = useCallback(() => {
    setTemp(null);
    setGateState('nincs');
    session.startManual();
  }, [session.startManual]);

  const stopManual = useCallback(() => {
    const v = session.stopManual();
    if (!temp || !v.manualResult) return;
    setTemp(null);
    const rows = tempSectionEndReports(v.manualResult, temp.startSent);
    if (rows) sendGates(rows);
    else setGateState('nem_hatarozhato');
  }, [session.stopManual, temp, sendGates]);

  const [sending, setSending] = useState<ReportChoice | null>(null);
  const report = useCallback(
    (choice: ReportChoice) => {
      if (choice === 'ideiglenes_szakasz') return startTempSection();
      const row = view.lastFix ? reportFromFix(choice, view.lastFix) : null;
      if (!row) return;
      const label = REPORT_CHOICES.find((c) => c.id === choice)?.label ?? 'Bejelentés';
      setSending(choice);
      createReports(supabase, [row])
        .then(([id]) => {
          if (id) feed.addOwn(ownReport(row, id, now()));
          showToast({ text: `Elküldve: ${label}`, tone: 'jo', icon: 'check' });
        })
        .catch(() => showToast({ text: 'Nem sikerült elküldeni – nincs kapcsolat?', tone: 'tul', icon: 'report' }))
        .finally(() => {
          setSending(null);
          setSheet(null);
        });
    },
    [view.lastFix, showToast, startTempSection, feed.addOwn, now],
  );

  // megerősítés / nincs ott (report_votes); szimulátorban csak helyben
  const [voting, setVoting] = useState(false);
  const vote = useCallback(
    (id: string, confirm: boolean) => {
      const done = () => {
        feed.vote(id, confirm);
        showToast({ text: confirm ? 'Köszönjük – megerősítve' : 'Köszönjük – jelezted, hogy nincs ott', tone: 'jo', icon: 'check' });
        setSelectedId(null);
      };
      if (SIM_MODE) return done();
      setVoting(true);
      voteReport(supabase, id, confirm)
        .then(done)
        .catch(() => showToast({ text: 'Nem sikerült elküldeni – nincs kapcsolat?', tone: 'tul', icon: 'report' }))
        .finally(() => setVoting(false));
    },
    [feed.vote, showToast],
  );

  const driving = view.phase === 'meres' || view.phase === 'kozeledik' || view.phase === 'kezi';
  const accuracy = view.lastFix?.accuracy ?? null;

  return (
    <>
      <StatusPills
        geo={SIM_MODE ? 'aktiv' : geo}
        accuracy={accuracy}
        wake={wake.status}
        offline={!SIM_MODE && (sectionsStatus === 'offline' || !supabase)}
        simMode={SIM_MODE && SIM_PANEL}
        compact={driving}
        onWake={() => {
          if (wake.status === 'nem_tamogatott')
            showToast({ text: 'Állítsd az automatikus zárolást „Soha” értékre', tone: 'hataron', icon: 'screen' });
          else wake.request();
        }}
      />
      {SIM_MODE && (
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
      <PlannedBand check={activePlanned} compact={measuring} />

      <div className="hud" ref={hudRef}>
        {view.phase === 'meres' && <SlowDown view={view} unit={settings.egyseg} />}
        {/* a HUD fölött lebeg (nem változtat a magasságán → a kamera nem ugrik); mérésnél a Lassíts-sáv fölött */}
        <div className="hud-float" data-raised={view.phase === 'meres'}>
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
          {!follow.following && (
            <div className="recenter-row">
              <button className="round-btn glass recenter" onClick={follow.recenter} aria-label="Vissza a helyemre">
                <Icon name="crosshair" size={28} />
              </button>
            </div>
          )}
        </div>
        <div className="actions">
          {!driving && view.phase !== 'kezi_eredmeny' && (
            <>
              <button className="round-btn glass" onClick={() => setSheet('settings')} aria-label="Beállítások">
                <Icon name="sliders" size={26} />
              </button>
              <button className="round-btn glass" onClick={startManual} aria-label="Kézi mérés indítása">
                <Icon name="stopwatch" size={26} />
              </button>
            </>
          )}
          <button className="round-btn glass report" onClick={() => setSheet('report')} aria-label="Bejelentés">
            <Icon name="report" size={28} />
          </button>
        </div>
        <Hud
          key={phaseKey(view)}
          view={view}
          settings={settings}
          gpsReady={view.lastFix !== null}
          tempSection={temp !== null}
          gateState={gateState}
          onStopManual={stopManual}
          onDismiss={session.dismiss}
          onRetryGates={() => gateRows && sendGates(gateRows)}
        />
      </div>

      {toast && (
        <div key={toast.id} className="toast glass" data-tone={toast.tone} role="status">
          <Icon name={toast.icon} size={22} /> {toast.text}
        </div>
      )}

      {sheet === 'report' && (
        <ReportSheet
          fix={view.lastFix}
          online={supabase !== null}
          sending={sending}
          manualRunning={view.phase === 'kezi'}
          onPick={report}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          settings={settings}
          update={update}
          simMode={SIM_MODE}
          onClose={() => setSheet(null)}
          info={{
            gps: SIM_MODE ? 'szimulátor' : GEO_TEXT[geo],
            wake: { aktiv: 'aktív', inaktiv: 'nem aktív', nem_tamogatott: 'nem támogatott' }[wake.status],
            sections: `${all.length} db · ${{ beepitett: 'beépített', betoltes: 'betöltés…', szerver: 'szerverről', offline_cache: 'cache (offline)', offline: 'beépített (offline)' }[sectionsStatus]}`,
            server: supabase ? 'beállítva' : 'nincs (offline mód)',
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
