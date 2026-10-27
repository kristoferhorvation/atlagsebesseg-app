import {
  formatDistance,
  formatDuration,
  speedIn,
  unitLabel,
  type InterruptReason,
  type SessionView,
  type Settings,
  type SpeedStatus,
} from '@atlagsebesseg/app-logic';
import { limitWithToleranceKmh } from '@atlagsebesseg/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { LimitSign } from './LimitSign';

/** Az ideiglenes szakasz kapuinak küldése a mérés végén. */
export type GateReportState = 'nincs' | 'kuldes' | 'elkuldve' | 'hiba' | 'nem_hatarozhato';

export interface HudProps {
  view: SessionView;
  settings: Settings;
  gpsReady: boolean;
  /** A kézi mérés egy ideiglenes szakasz (indításkor a kezdő kapu bejelentve, „Vége” = záró kapu). */
  tempSection: boolean;
  gateState: GateReportState;
  onStopManual: () => void;
  onDismiss: () => void;
  onRetryGates: () => void;
}

export const STATUS_META: Record<SpeedStatus, { icon: IconName; label: string }> = {
  jo: { icon: 'check', label: 'Jó ütem' },
  hataron: { icon: 'approx', label: 'Határon' },
  tul: { icon: 'arrowUp', label: 'Határ felett' },
};

const INTERRUPT_TEXT: Record<InterruptReason, string> = {
  hatter: 'Az app háttérbe került',
  letert: 'Letértél a szakaszról',
  ellenirany: 'Ellenirányban haladsz',
  jelvesztes: 'Túl hosszú GPS-kiesés',
};

const GATE_TEXT: Record<Exclude<GateReportState, 'nincs'>, string> = {
  kuldes: 'Kapuk küldése…',
  elkuldve: 'Ideiglenes szakasz bejelentve – mások megerősítésére vár.',
  hiba: 'A kapukat nem sikerült elküldeni – nincs kapcsolat?',
  nem_hatarozhato: 'A kapuk helye nem határozható meg (kevés GPS-adat), nem küldtük el.',
};

/** A kijelző tónusa (DESIGN.md): mérésnél a státusz, kézi módban az accent. */
export function toneOf(view: SessionView): string {
  if (view.phase === 'kezi' || view.phase === 'kezi_eredmeny') return 'kezi';
  if (view.phase === 'megszakadt') return 'semleges';
  return view.status ?? (view.phase === 'kozeledik' ? 'kezi' : 'semleges');
}

function Card({ tone, children, label }: { tone: string; children: ReactNode; label: string }) {
  return (
    <section className="card glass card-stack" data-tone={tone} aria-label={label} aria-live="polite">
      {children}
    </section>
  );
}

const Hero = ({ value }: { value: number | null }) => <div className="hero num">{value ?? '–'}</div>;

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress-row">
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <i style={{ '--p': value } as CSSProperties} />
      </div>
      <div className="progress-label num">{label}</div>
    </div>
  );
}

const dist = (m: number, unit: Settings['egyseg']) => {
  const d = formatDistance(m, unit);
  return `${d.value} ${d.unit}`;
};

export function Hud(p: HudProps) {
  const { view, settings } = p;
  const unit = settings.egyseg;
  const u = unitLabel(unit);
  const tone = toneOf(view);

  switch (view.phase) {
    case 'meres': {
      const s = view.section!;
      const live = view.live!;
      const meta = view.status ? STATUS_META[view.status] : null;
      const req = live.required;
      const chip: ReactNode =
        req.kind === 'nem_lehetseges' ? (
          <span className="chip" data-tone="tul">
            <Icon name="arrowUp" /> Már nem hozható be
          </span>
        ) : meta ? (
          <span className="chip">
            <Icon name={meta.icon} /> {meta.label}
          </span>
        ) : (
          <span className="chip neutral">Mérés indul…</span>
        );
      return (
        <Card tone={tone} label="Mérés">
          <div className="row">
            {chip}
            {live.estimated && (
              <span className="chip neutral" aria-label="Becsült érték, nincs GPS">
                <Icon name="tunnel" /> Becslés
              </span>
            )}
          </div>
          <Hero value={speedIn(live.averageKmh, unit)} />
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <LimitSign kmh={s.speedLimitKmh} unit={unit} small />
            <div>
              <div className="body muted">{u} átlag</div>
              {live.projectedKmh !== null && (
                <div className="body muted">
                  várható <span className="num strong">{speedIn(live.projectedKmh, unit)}</span>
                </div>
              )}
              {settings.hatosagi_tures_megjelenitese && (
                <div className="tolerance num">tűréssel {speedIn(limitWithToleranceKmh(s.speedLimitKmh), unit)}</div>
              )}
            </div>
          </div>
          <Progress value={view.progress ?? 0} label={dist(live.remainingM, unit)} />
        </Card>
      );
    }

    case 'kozeledik': {
      const s = view.section!;
      return (
        <Card tone={tone} label="Mérőszakasz közeleg">
          <div className="row">
            <span className="chip">
              <Icon name="approach" /> Mérőszakasz
            </span>
          </div>
          <div className="hero-row">
            <div className="hero-col">
              <div className="display num">
                {view.approachM !== null ? formatDistance(view.approachM, unit).value : '–'}
                <small>{view.approachM !== null ? `${formatDistance(view.approachM, unit).unit} múlva` : ''}</small>
              </div>
              <div className="body muted" style={{ marginTop: 8 }}>
                {[s.road, s.direction].filter(Boolean).join(' · ') || 'Átlagsebesség-mérés'}
              </div>
            </div>
            <LimitSign kmh={s.speedLimitKmh} unit={unit} />
          </div>
        </Card>
      );
    }

    case 'befejezve': {
      const r = view.result!;
      const diff = Math.round(Math.abs((speedIn(r.averageKmh, unit) ?? 0) - (speedIn(r.speedLimitKmh, unit) ?? 0)));
      const meta = STATUS_META[view.status ?? 'jo'];
      return (
        <Card tone={tone} label="Szakasz vége">
          <div className="row">
            <span className="chip">
              <Icon name={meta.icon} /> {r.overLimit ? `+${diff} ${u} a határ felett` : 'A határ alatt'}
            </span>
          </div>
          <Hero value={speedIn(r.averageKmh, unit)} />
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <LimitSign kmh={r.speedLimitKmh} unit={unit} small />
            <div className="body muted">{u} végső átlag</div>
          </div>
          <div className="stats two">
            <div className="stat">
              <b className="num">{dist(r.lengthM, unit)}</b>
              <span>szakasz</span>
            </div>
            <div className="stat">
              <b className="num">{formatDuration(r.exitTime - r.entryTime)}</b>
              <span>menetidő</span>
            </div>
          </div>
          <button className="btn" onClick={p.onDismiss}>
            Kész
          </button>
        </Card>
      );
    }

    case 'megszakadt': {
      const reason = view.interruption?.reason ?? 'jelvesztes';
      const manual = !view.section;
      return (
        <Card tone={tone} label="Mérés megszakadt">
          <div className="row">
            <span className="chip">
              <Icon name="pause" /> {manual ? 'Kézi mérés megszakadt' : 'Mérés megszakadt'}
            </span>
          </div>
          <div className="title">{INTERRUPT_TEXT[reason]}</div>
          <div className="body muted">
            Az átlag nem érvényes.{' '}
            {reason === 'hatter'
              ? 'A háttérben nincs GPS, ezért lezártuk – a következő szakasz elején újraindul.'
              : 'A következő szakasz elején újraindul.'}
          </div>
          <button className="btn" onClick={p.onDismiss}>
            Rendben
          </button>
        </Card>
      );
    }

    case 'kezi': {
      const m = view.manual!;
      return (
        <Card tone={tone} label={p.tempSection ? 'Ideiglenes szakasz' : 'Kézi mérés'}>
          <div className="row">
            <span className="chip">
              <Icon name={p.tempSection ? 'kapu_kezdo' : 'stopwatch'} /> {p.tempSection ? 'Ideiglenes szakasz' : 'Kézi mérés'}
            </span>
            <span className="title num muted">{formatDuration(m.elapsedMs)}</span>
          </div>
          <Hero value={speedIn(m.averageKmh, unit)} />
          <div className="row">
            <div className="body muted">{u} átlag</div>
            <div className="body num">{dist(m.distanceM, unit)}</div>
          </div>
          {p.tempSection ? (
            <button className="btn primary" onClick={p.onStopManual}>
              <Icon name="kapu_zaro" /> Vége · záró kapu
            </button>
          ) : (
            <button className="btn danger" onClick={p.onStopManual}>
              <Icon name="stop" /> Leállítás
            </button>
          )}
        </Card>
      );
    }

    case 'kezi_eredmeny': {
      const r = view.manualResult!;
      return (
        <Card tone={tone} label="Kézi mérés eredménye">
          <div className="row">
            <span className="chip">
              <Icon name="check" /> Kézi mérés kész
            </span>
          </div>
          <Hero value={speedIn(r.averageKmh, unit)} />
          <div className="body muted">{u} átlag</div>
          <div className="stats two">
            <div className="stat">
              <b className="num">{dist(r.distanceM, unit)}</b>
              <span>távolság{r.estimatedGapM > 0 ? ' (részben becsült)' : ''}</span>
            </div>
            <div className="stat">
              <b className="num">{formatDuration(r.elapsedMs)}</b>
              <span>idő</span>
            </div>
          </div>
          {p.gateState !== 'nincs' && <div className="body muted">{GATE_TEXT[p.gateState]}</div>}
          <div className={p.gateState === 'hiba' ? 'btn-row' : undefined}>
            {p.gateState === 'hiba' && (
              <button className="btn primary" onClick={p.onRetryGates}>
                Újraküldés
              </button>
            )}
            <button className="btn" onClick={p.onDismiss}>
              Kész
            </button>
          </div>
        </Card>
      );
    }

    case 'nincs_szakasz':
      return (
        <Card tone={tone} label="Nincs mérőszakasz">
          <div className="hero-row">
            <div className="display num">
              {p.gpsReady ? (speedIn(view.currentKmh ?? 0, unit) ?? 0) : '–'}
              <small>{u}</small>
            </div>
          </div>
          <div className="body muted">{p.gpsReady ? 'Nincs mérőszakasz a közelben' : 'GPS-jelre vár…'}</div>
        </Card>
      );
  }
}

/**
 * Késleltetett kapcsoló: bekapcsol, ha a feltétel `onMs`-ig fennáll, kikapcsol, ha `offMs`-ig
 * nem – így a határérték körüli 1 Hz-es ingadozás nem villogtat.
 */
function useSteady(value: boolean, onMs: number, offMs: number): boolean {
  const [steady, setSteady] = useState(value);
  useEffect(() => {
    if (value === steady) return;
    const id = setTimeout(() => setSteady(value), value ? onMs : offMs);
    return () => clearTimeout(id);
  }, [value, steady, onMs, offMs]);
  return steady;
}

/**
 * „Lassíts · max X” – külön, nagy, középen, csak amikor kell. Mindig a DOM-ban van (a mérés
 * alatt), és opacity/transform átmenettel jelenik meg / tűnik el; eltűnéskor az utolsó érték marad.
 */
export function SlowDown({ view, unit }: { view: SessionView; unit: Settings['egyseg'] }) {
  const live = view.phase === 'meres' ? view.live : null;
  const req = live?.required;
  const need = req?.kind === 'ok' && (live?.slowDownKmh ?? 0) >= 1;
  const show = useSteady(need, 1500, 3000);
  const last = useRef<number | null>(null);
  if (need && req?.kind === 'ok') last.current = speedIn(req.maxKmh, unit);
  return (
    <div className="slowdown glass" data-tone={view.status ?? 'tul'} data-show={show && last.current !== null} aria-hidden={!show} role="status">
      <Icon name="arrowDown" size={30} />
      <span className="slowdown-label">Lassíts</span>
      <span className="slowdown-max">
        max <b className="num">{last.current ?? ''}</b>
      </span>
    </div>
  );
}
