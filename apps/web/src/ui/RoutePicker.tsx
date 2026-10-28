import { formatClock, formatDistance, formatTripDuration, t, type RouteSummary, type SpeedUnit } from '@atlagsebesseg/app-logic';
import type { PlanState } from '../nav/useNavigation';
import { Icon } from './Icon';

/** Útvonalválasztó kártya: idő, táv, szakaszellenőrzések és kamerák száma, késés dugó miatt; „Indítás”. */
export function RoutePicker({
  plan,
  summaries,
  unit,
  now,
  onSelect,
  onStart,
  onRetry,
  onClose,
}: {
  plan: PlanState;
  summaries: readonly RouteSummary[];
  unit: SpeedUnit;
  now: number;
  onSelect: (i: number) => void;
  onStart: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const msg =
    plan.status === 'loading'
      ? t('nav.picker.loading')
      : plan.status === 'nogps'
        ? t('nav.picker.noGps')
        : plan.status === 'ratelimited'
          ? t('nav.picker.rateLimited')
          : plan.status === 'error'
            ? t('nav.picker.error')
            : null;
  return (
    <section className="picker glass" aria-label={t('nav.picker.title', { name: plan.dest.name })}>
      <div className="picker-head">
        <div className="title picker-title">{t('nav.picker.title', { name: plan.dest.name })}</div>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" size={20} />
        </button>
      </div>
      {msg && (
        <div className="picker-msg" data-status={plan.status}>
          {msg}
          {(plan.status === 'error' || plan.status === 'ratelimited' || plan.status === 'nogps') && (
            <button className="btn picker-retry" onClick={onRetry}>
              <Icon name="restart" size={22} /> {t('nav.picker.retry')}
            </button>
          )}
        </div>
      )}
      {plan.status === 'ready' && (
        <>
          <div className="picker-list" role="radiogroup">
            {plan.routes.map((r, i) => {
              const s = summaries[i];
              if (!s) return null;
              const d = formatDistance(s.distanceM, unit);
              return (
                <button key={r.id} className="route-opt" role="radio" aria-checked={plan.selected === i} data-selected={plan.selected === i} onClick={() => onSelect(i)}>
                  <div className="route-opt-main">
                    <b className="num">{formatTripDuration(s.durationS)}</b>
                    <span className="num">
                      {d.value} {d.unit} · {formatClock(now + s.durationS * 1000)}
                    </span>
                    <span className="route-opt-tag">{i === 0 ? t('nav.picker.fastest') : t('nav.picker.alt', { n: i })}</span>
                  </div>
                  <div className="route-opt-meta">
                    <span data-zero={s.sections === 0}>
                      <Icon name="rendorseg" size={18} /> {t('nav.picker.sections', { n: s.sections })}
                    </span>
                    <span data-zero={s.cameras === 0}>
                      <Icon name="cam_speed" size={18} /> {t('nav.picker.cameras', { n: s.cameras, v: s.camerasVerified })}
                    </span>
                    <span data-delay={s.delayS >= 60}>{s.delayS >= 60 ? t('nav.picker.delay', { n: Math.round(s.delayS / 60) }) : t('nav.picker.noDelay')}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <button className="btn primary picker-start" onClick={onStart}>
            <Icon name="play" size={22} /> {t('nav.picker.start')}
          </button>
        </>
      )}
    </section>
  );
}
