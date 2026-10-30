import {
  formatDistance,
  sectionSourceLabel,
  formatDuration,
  speedFloorIn,
  speedIn,
  t,
  unitLabel,
  type TKey,
  type InterruptReason,
  type SessionView,
  type Settings,
  type SpeedStatus,
} from '@atlagsebesseg/app-logic';
import { limitWithToleranceKmh, meterBar, type MeterBar, type Section } from '@atlagsebesseg/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { tNode } from '../i18n';
import { Icon, type IconName } from './Icon';
import { LimitSign } from './LimitSign';

export interface HudProps {
  view: SessionView;
  settings: Settings;
  gpsReady: boolean;
  /** Navigáció közben (AOS13) a mérés eredménye egy sor (`navResultCompact`; AW15: a kézi mérésé is). */
  navCompact?: boolean;
  /** AW15: navigáció közben a kézi mérés teljes kártyája bökésre pillé zsugorodik (a gombok kivételével). */
  onCollapseManual?: () => void;
  onStopManual: () => void;
  onDismiss: () => void;
}

export const STATUS_META: Record<SpeedStatus, { icon: IconName; label: TKey }> = {
  jo: { icon: 'check', label: 'status.good' },
  lassits: { icon: 'arrowDown', label: 'status.slow' },
  tul_gyors: { icon: 'arrowUp', label: 'status.fast' },
};

const INTERRUPT_TEXT: Record<InterruptReason, TKey> = {
  hatter: 'interrupt.background',
  letert: 'interrupt.offRoute',
  ellenirany: 'interrupt.wrongWay',
  jelvesztes: 'interrupt.gpsLoss',
};

/** A kijelző tónusa (DESIGN.md): mérésnél a státusz, kézi módban az accent. */
export function toneOf(view: SessionView): string {
  if (view.phase === 'kezi' || view.phase === 'kezi_eredmeny') return 'kezi';
  if (view.phase === 'megszakadt') return 'semleges';
  return view.status ?? (view.phase === 'kozeledik' ? 'kezi' : 'semleges');
}

function Card({ tone, children, label, compact, onTap }: { tone: string; children: ReactNode; label: string; compact?: boolean; onTap?: () => void }) {
  return (
    <section
      className={`card glass card-stack${compact ? ' compact' : ''}`}
      data-tone={tone}
      aria-label={label}
      aria-live="polite"
      // a kártyán lévő gomb (Leállítás) a saját dolgát végzi, nem csukja össze
      onClick={onTap && ((e) => !(e.target as Element).closest('button') && onTap())}
    >
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
      const chip: ReactNode = meta ? (
        <span className="chip">
          <Icon name={meta.icon} /> {t(meta.label)}
        </span>
      ) : (
        <span className="chip neutral">{t('hud.starting')}</span>
      );
      return (
        <Card tone={tone} label={t('hud.measure')}>
          <div className="row">
            {chip}
            {live.estimated && (
              <span className="chip neutral" aria-label={t('hud.estimateAria')}>
                <Icon name="tunnel" /> {t('hud.estimate')}
              </span>
            )}
          </div>
          <Hero value={speedIn(live.averageKmh, unit)} />
          <div className="body muted hero-unit">{t('hud.avg', { u })}</div>
          <div className="meter-line">
            <div className="sign-col">
              <LimitSign kmh={s.speedLimitKmh} unit={unit} small />
              {settings.hatosagi_tures_megjelenitese && (
                <div className="tolerance num">{t('hud.tolerance', { x: speedFloorIn(limitWithToleranceKmh(s.speedLimitKmh), unit) ?? '' })}</div>
              )}
            </div>
            <div className="meter-fig">
              <span className="body muted">{t('hud.now')}</span>
              {/* az állapot nem változik: a „most” önállóan jelzi, ha a pillanatnyi sebesség a határ felett van */}
              <b className="meter-num num" data-over={(view.currentKmh ?? 0) > s.speedLimitKmh}>{speedIn(view.currentKmh, unit) ?? '–'}</b>
            </div>
            <span className="meter-sep" aria-hidden="true">
              ·
            </span>
            <div className="meter-fig">
              <span className="body muted">{t('hud.expected')}</span>
              <b className="meter-num num">{speedIn(live.projectedKmh, unit) ?? '–'}</b>
            </div>
          </div>
          <Progress value={view.progress ?? 0} label={dist(live.remainingM, unit)} />
        </Card>
      );
    }

    case 'kozeledik': {
      const s = view.section!;
      return (
        <Card tone={tone} label={t('hud.approach.aria')}>
          <div className="row">
            <span className="chip">
              <Icon name="approach" /> {t('hud.approach.chip')}
            </span>
          </div>
          <div className="hero-row">
            <div className="hero-col">
              <div className="display num">
                {view.approachM !== null ? formatDistance(view.approachM, unit).value : '–'}
                <small>{view.approachM !== null ? t('hud.ahead', { u: formatDistance(view.approachM, unit).unit }) : ''}</small>
              </div>
              <div className="body muted" style={{ marginTop: 8 }}>
                {[s.road, s.direction].filter(Boolean).join(' · ') || t('hud.approach.default')}
              </div>
            </div>
            <LimitSign kmh={s.speedLimitKmh} unit={unit} />
          </div>
          <SourceLine section={s} />
        </Card>
      );
    }

    case 'befejezve': {
      const r = view.result!;
      const diff = Math.round(Math.abs((speedIn(r.averageKmh, unit) ?? 0) - (speedIn(r.speedLimitKmh, unit) ?? 0)));
      const meta = STATUS_META[view.status ?? 'jo'];
      if (p.navCompact)
        return (
          // navigáció közben egy sor: a nagy kártya a felső lépés-kártya alá érne
          <Card tone={tone} label={t('hud.done.aria')} compact>
            <div className="compact-row">
              <div className="compact-speed num tone">{speedIn(r.averageKmh, unit) ?? '–'}</div>
              <div className="compact-text">
                <div className="body muted">{t('hud.done.final', { u })}</div>
                <div className="compact-status">
                  <Icon name={meta.icon} size={16} /> {r.overLimit ? t('hud.done.over', { x: diff, u }) : t('hud.done.under')}
                </div>
              </div>
              <button className="mini-btn" onClick={p.onDismiss}>
                {t('common.done')}
              </button>
            </div>
          </Card>
        );
      return (
        <Card tone={tone} label={t('hud.done.aria')}>
          <div className="row">
            <span className="chip">
              <Icon name={meta.icon} /> {r.overLimit ? t('hud.done.over', { x: diff, u }) : t('hud.done.under')}
            </span>
          </div>
          <Hero value={speedIn(r.averageKmh, unit)} />
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <LimitSign kmh={r.speedLimitKmh} unit={unit} small />
            <div className="body muted">{t('hud.done.final', { u })}</div>
          </div>
          <div className="stats two">
            <div className="stat">
              <b className="num">{dist(r.lengthM, unit)}</b>
              <span>{t('hud.done.section')}</span>
            </div>
            <div className="stat">
              <b className="num">{formatDuration(r.exitTime - r.entryTime)}</b>
              <span>{t('hud.done.duration')}</span>
            </div>
          </div>
          {view.section && <SourceLine section={view.section} />}
          <button className="btn" onClick={p.onDismiss}>
            {t('common.done')}
          </button>
        </Card>
      );
    }

    case 'megszakadt': {
      const reason = view.interruption?.reason ?? 'jelvesztes';
      const manual = !view.section;
      return (
        <Card tone={tone} label={t('hud.interrupted.aria')}>
          <div className="row">
            <span className="chip">
              <Icon name="pause" /> {manual ? t('hud.interrupted.manual') : t('hud.interrupted.auto')}
            </span>
          </div>
          <div className="title">{t(INTERRUPT_TEXT[reason])}</div>
          <div className="body muted">
            {t('hud.interrupted.invalid')} {reason === 'hatter' ? t('hud.interrupted.background') : t('hud.interrupted.restart')}
          </div>
          <button className="btn" onClick={p.onDismiss}>
            {t('common.ok')}
          </button>
        </Card>
      );
    }

    case 'kezi': {
      const m = view.manual!;
      return (
        <Card tone={tone} label={t('hud.manual')} onTap={p.onCollapseManual}>
          <div className="row">
            <span className="chip">
              <Icon name="stopwatch" /> {t('hud.manual')}
            </span>
            <span className="title num muted">{formatDuration(m.elapsedMs)}</span>
          </div>
          <Hero value={speedIn(m.averageKmh, unit)} />
          <div className="row">
            <div className="body muted">{t('hud.avg', { u })}</div>
            <div className="body num">{dist(m.distanceM, unit)}</div>
          </div>
          <button className="btn danger" onClick={p.onStopManual}>
            <Icon name="stop" /> {t('hud.manual.stop')}
          </button>
        </Card>
      );
    }

    case 'kezi_eredmeny': {
      const r = view.manualResult!;
      if (p.navCompact)
        return (
          // AW15: navigáció közben egy sor
          <Card tone={tone} label={t('hud.manualDone.aria')} compact>
            <div className="compact-row">
              <div className="compact-speed num tone">{speedIn(r.averageKmh, unit) ?? '–'}</div>
              <div className="compact-text">
                <div className="body muted">{t('hud.avg', { u })}</div>
                <div className="compact-status num">
                  <Icon name="stopwatch" size={16} /> {dist(r.distanceM, unit)} · {formatDuration(r.elapsedMs)}
                </div>
              </div>
              <button className="mini-btn" onClick={p.onDismiss}>
                {t('common.done')}
              </button>
            </div>
          </Card>
        );
      return (
        <Card tone={tone} label={t('hud.manualDone.aria')}>
          <div className="row">
            <span className="chip">
              <Icon name="check" /> {t('hud.manualDone.chip')}
            </span>
          </div>
          <Hero value={speedIn(r.averageKmh, unit)} />
          <div className="body muted">{t('hud.avg', { u })}</div>
          <div className="stats two">
            <div className="stat">
              <b className="num">{dist(r.distanceM, unit)}</b>
              <span>{t(r.estimatedGapM > 0 ? 'hud.manualDone.distanceEst' : 'hud.manualDone.distance')}</span>
            </div>
            <div className="stat">
              <b className="num">{formatDuration(r.elapsedMs)}</b>
              <span>{t('hud.manualDone.time')}</span>
            </div>
          </div>
          <button className="btn" onClick={p.onDismiss}>
            {t('common.done')}
          </button>
        </Card>
      );
    }

    case 'nincs_szakasz':
      return (
        // kompakt alapállapot: egy sor, hogy a térkép lássa a képernyő ~80%-át
        <Card tone={tone} label={t('hud.none.aria')} compact>
          <div className="compact-row">
            <div className="compact-speed num">
              {p.gpsReady ? (speedIn(view.currentKmh ?? 0, unit) ?? 0) : '–'}
              <small>{u}</small>
            </div>
            <div className="body muted">{p.gpsReady ? t('hud.none.near') : t('hud.none.waiting')}</div>
          </div>
        </Card>
      );
  }
}

/**
 * AW16: navigáció közben a kézi mérés a mérőkártya lekicsinyített változata a jobb oldalon: a nagy átlag-szám a
 * megszokott státusz-színnel (jó / lassíts / túl gyors; ismeretlen határnál a kézi-mérés színe), alatta „km/h átlag” és
 * az eltelt idő; Leállítás gomb nélkül. Bökésre a teljes kártya nyílik.
 */
export function ManualMini({ view, unit, status, onExpand }: { view: SessionView; unit: Settings['egyseg']; status: SpeedStatus | null; onExpand: () => void }) {
  const m = view.manual!;
  return (
    <button className="manual-mini glass" data-tone={status ?? 'kezi'} data-status={status ?? 'kezi'} onClick={onExpand} aria-label={t('hud.manual.pillAria')}>
      <b className="num">{speedIn(m.averageKmh, unit) ?? '–'}</b>
      <small>{t('hud.avg', { u: unitLabel(unit) })}</small>
      <span className="num">
        <Icon name="stopwatch" size={14} /> {formatDuration(m.elapsedMs)}
      </span>
    </button>
  );
}

/** A szakasz forrása és (ha hivatalos listán ellenőrzött) a jelölés. */
function SourceLine({ section }: { section: Section }) {
  return (
    <div className="source-line">
      {section.verified && (
        <span className="verified">
          <Icon name="check" size={18} /> {t('source.verified')}
        </span>
      )}
      <span className="muted">{sectionSourceLabel(section)}</span>
    </div>
  );
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
  const bar = live ? meterBar(view.status, live.required) : null;
  const show = useSteady(bar !== null, 1500, 3000);
  // eltűnéskor az utolsó tartalom (és színe) marad, hogy ne ugorjon a kifutó animáció alatt
  const last = useRef<{ bar: MeterBar; tone: string } | null>(null);
  if (bar) last.current = { bar, tone: view.status ?? 'tul_gyors' };
  const shown = last.current;
  return (
    <div className="slowdown glass" data-tone={shown?.tone ?? 'tul_gyors'} data-show={show && shown !== null} aria-hidden={!show} role="status">
      {shown?.bar.kind === 'nem_hozhato' ? (
        <>
          <Icon name="arrowUp" size={30} />
          <span className="slowdown-label">{t('slowdown.cant')}</span>
        </>
      ) : shown?.tone === 'lassits' ? (
        <>
          <Icon name="arrowDown" size={30} />
          <span className="slowdown-label">{tNode('slowdown.stay', { x: <b className="num slowdown-num">{shown ? speedIn(shown.bar.maxKmh, unit) : ''}</b> })}</span>
        </>
      ) : (
        <>
          <Icon name="arrowDown" size={30} />
          <span className="slowdown-label">{tNode('slowdown.slow', { x: <b className="num slowdown-num">{shown ? speedIn(shown.bar.maxKmh, unit) : ''}</b> })}</span>
        </>
      )}
    </div>
  );
}
