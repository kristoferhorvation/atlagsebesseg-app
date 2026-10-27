import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createReports,
  gateReportsFromManual,
  mergeById,
  REPORT_CHOICES,
  reportFromFix,
  type ReportChoice,
  type SessionView,
} from '@atlagsebesseg/app-logic';
import { BUNDLED_SECTIONS } from '@atlagsebesseg/app-logic/bundled-sections';
import type { GpsFix, Section } from '@atlagsebesseg/core';
import { statusColor } from '@atlagsebesseg/design-tokens';
import { supabase } from './backend';
import { useGeolocation, type GeoStatus } from './hooks/useGeolocation';
import { useLightPreset } from './hooks/useLightPreset';
import { useSections } from './hooks/useSections';
import { useSession } from './hooks/useSession';
import { useSettings } from './hooks/useSettings';
import { useWakeLock } from './hooks/useWakeLock';
import { createWebMapAdapter, type WebMapAdapter } from './map';
import { simStartFromUrl, useSimulator } from './sim/useSimulator';
import { Hud, toneOf, type GateReportState } from './ui/Hud';
import { Icon, type IconName } from './ui/Icon';
import { ReportSheet } from './ui/ReportSheet';
import { SettingsSheet } from './ui/SettingsSheet';
import { SimPanel } from './ui/SimPanel';
import { StartScreen } from './ui/StartScreen';
import { StatusPills } from './ui/StatusPills';

const SIM_MODE = new URLSearchParams(location.search).has('sim');

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
  useEffect(() => map.followUser(true), [map]);
  useEffect(() => map.setLightPreset(lightPreset), [map, lightPreset]);
  useEffect(() => map.showSections(all, highlightId), [map, all, highlightId]);
  useEffect(() => map.setPosition(view.lastFix), [map, view.lastFix]);
  useEffect(
    () => map.setProgress(view.phase === 'meres' ? view.progress : null, statusColor[tone as keyof typeof statusColor] ?? statusColor.kezi),
    [map, view.phase, view.progress, tone],
  );
  const big = view.phase !== 'nincs_szakasz';
  useEffect(() => map.setFocusY(big ? 0.3 : 0.45), [map, big]);

  // lapok, visszajelzés
  const [sheet, setSheet] = useState<'report' | 'settings' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const [sending, setSending] = useState<ReportChoice | null>(null);
  const report = useCallback(
    (choice: ReportChoice) => {
      const row = view.lastFix ? reportFromFix(choice, view.lastFix) : null;
      if (!row) return;
      const label = REPORT_CHOICES.find((c) => c.id === choice)?.label ?? 'Bejelentés';
      setSending(choice);
      createReports(supabase, [row])
        .then(() => showToast({ text: `Elküldve: ${label}`, tone: 'jo', icon: 'check' }))
        .catch(() => showToast({ text: 'Nem sikerült elküldeni – nincs kapcsolat?', tone: 'tul', icon: 'report' }))
        .finally(() => {
          setSending(null);
          setSheet(null);
        });
    },
    [view.lastFix, showToast],
  );

  const [gateState, setGateState] = useState<GateReportState>('nincs');
  useEffect(() => setGateState('nincs'), [view.manualResult]);
  const gateRows = view.manualResult ? gateReportsFromManual(view.manualResult) : null;
  const reportGates = useCallback(() => {
    if (!gateRows) return;
    setGateState('kuldes');
    createReports(supabase, gateRows)
      .then(() => setGateState('elkuldve'))
      .catch(() => setGateState('hiba'));
  }, [gateRows]);

  const driving = view.phase === 'meres' || view.phase === 'kozeledik' || view.phase === 'kezi';
  const accuracy = view.lastFix?.accuracy ?? null;

  return (
    <>
      <StatusPills
        geo={geo}
        accuracy={accuracy}
        wake={wake.status}
        offline={!SIM_MODE && (sectionsStatus === 'offline' || !supabase)}
        simMode={SIM_MODE}
        compact={driving}
        onWake={() => {
          if (wake.status === 'nem_tamogatott')
            showToast({ text: 'Állítsd az automatikus zárolást „Soha” értékre', tone: 'hataron', icon: 'screen' });
          else wake.request();
        }}
      />
      {SIM_MODE && <SimDriver onFix={onFix} onTick={session.tick} clock={clock} onSection={setSimSection} onBackground={session.interrupt} />}

      <div className="hud">
        <div className="actions">
          {!driving && view.phase !== 'kezi_eredmeny' && (
            <>
              <button className="round-btn glass" onClick={() => setSheet('settings')} aria-label="Beállítások">
                <Icon name="sliders" size={26} />
              </button>
              <button className="round-btn glass" onClick={session.startManual} aria-label="Kézi mérés indítása">
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
          canReportGates={gateRows !== null && supabase !== null}
          gateState={gateState}
          onStopManual={session.stopManual}
          onDismiss={session.dismiss}
          onReportGates={reportGates}
        />
      </div>

      {toast && (
        <div key={toast.id} className="toast glass" data-tone={toast.tone} role="status">
          <Icon name={toast.icon} size={22} /> {toast.text}
        </div>
      )}

      {sheet === 'report' && (
        <ReportSheet fix={view.lastFix} online={supabase !== null} sending={sending} onPick={report} onClose={() => setSheet(null)} />
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
  onBackground,
}: {
  onFix: (f: GpsFix) => void;
  onTick: () => void;
  clock: { current: () => number };
  onSection: (s: Section) => void;
  onBackground: () => void;
}) {
  const sim = useSimulator(BUNDLED_SECTIONS, { onFix, onTick }, useMemo(() => simStartFromUrl(location.search), []));
  // az óra és a teszt-szakasz még a lejátszás (és a seek) előtt beáll
  useLayoutEffect(() => {
    clock.current = sim.now;
    onSection(sim.section);
  }, [clock, sim.now, onSection, sim.section]);
  return <SimPanel sim={sim} onBackground={onBackground} />;
}
