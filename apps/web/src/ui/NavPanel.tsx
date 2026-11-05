import { formatClock, formatDistance, formatTripDuration, routeTimeline, routeTagText, t, type AltChoice, type NavView, type Settings, type TimelineEvent, type TimelineKind, type TKey } from '@atlagsebesseg/app-logic';
import { useLayoutEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from './Icon';

const EVENT_ICON: Record<TimelineKind, IconName> = { section: 'rendorseg', camera: 'cam_speed', planned: 'rendorseg', jam: 'dugo', report: 'report' };
const EVENT_LABEL: Record<TimelineKind, TKey> = {
  section: 'nav.panel.ev.section',
  camera: 'nav.panel.ev.camera',
  planned: 'nav.panel.ev.planned',
  jam: 'nav.panel.ev.jam',
  report: 'nav.panel.ev.report',
};

type AltState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ok'; choices: AltChoice[] };

/**
 * AW23: az alsó sávra koppintva felnyíló panel: vízszintes sáv a hátralévő útról, rajta a várható események a távval arányos helyen;
 * alatta az „Alternatív útvonalak” (a jelenlegi pozícióból, a meglévő útvonalválasztó kompakt formája). A navigáció közben nem áll le.
 */
export function NavPanel({
  view,
  unit,
  reports,
  now,
  request,
  onChoose,
  onAlts,
}: {
  view: NavView;
  unit: Settings['egyseg'];
  reports: readonly { lat: number; lon: number }[];
  now: number;
  request: () => Promise<AltChoice[]>;
  onChoose: (c: AltChoice) => void;
  /** Az éppen látható alternatívák (a térkép megmutatja). */
  onAlts: (c: readonly AltChoice[] | null) => void;
}) {
  const [alts, setAlts] = useState<AltState>({ status: 'idle' });
  // közvetlenül az alsó sáv fölött (a sáv magassága a dugó-felirattal változik)
  const [bottom, setBottom] = useState(112);
  useLayoutEffect(() => {
    const bar = document.querySelector('.nav-bottom');
    if (bar) setBottom(window.innerHeight - bar.getBoundingClientRect().top + 12);
  }, [view.delayMin !== null]);
  const events = useMemo<TimelineEvent[]>(
    () => routeTimeline(view.trafficRoute, view.trafficAlongM, view.enforcement.filter((e) => view.trafficAlongM >= 0 && e.startM > view.alongM).map((e) => ({ ...e, startM: e.startM - view.alongM + view.trafficAlongM })), reports),
    [view.trafficRoute, Math.round(view.trafficAlongM / 50), view.enforcement, reports],
  );
  const rest = formatDistance(view.remainingM, unit);
  const open = () => {
    setAlts({ status: 'loading' });
    request().then(
      (choices) => {
        setAlts({ status: 'ok', choices });
        onAlts(choices);
      },
      () => setAlts({ status: 'error' }),
    );
  };
  const cancel = () => {
    setAlts({ status: 'idle' });
    onAlts(null);
  };
  return (
    <section className="nav-panel glass" style={{ bottom }} aria-label={t('nav.panel.aria')} data-testid="nav-panel" onClick={(e) => e.stopPropagation()}>
      <div className="timeline" role="list">
        <div className="timeline-line" />
        <div className="timeline-here" />
        {events.map((e, i) => (
          <span key={`${e.kind}-${i}`} role="listitem" className="timeline-ev" data-kind={e.kind} style={{ left: `${Math.min(100, e.at * 100)}%` }} aria-label={`${t(EVENT_LABEL[e.kind])} ${formatDistance(e.aheadM, unit).value} ${formatDistance(e.aheadM, unit).unit}`}>
            <Icon name={EVENT_ICON[e.kind]} size={16} />
          </span>
        ))}
        <Icon name="pin" size={18} />
      </div>
      <div className="timeline-foot num">
        <span>{formatTripDuration(view.remainingS)}</span>
        <span>
          {rest.value} {rest.unit}
        </span>
      </div>
      {alts.status === 'idle' && (
        <button className="btn nav-panel-alt" onClick={open}>
          {t('nav.panel.alternatives')}
        </button>
      )}
      {alts.status === 'loading' && <div className="search-note">{t('nav.panel.loading')}</div>}
      {alts.status === 'error' && <div className="search-note" data-tone="tul">{t('nav.panel.error')}</div>}
      {alts.status === 'ok' && (
        <div className="picker-list" role="radiogroup">
          {alts.choices.filter((c) => !c.current).length === 0 && <div className="search-note">{t('nav.panel.none')}</div>}
          {alts.choices.map((c, i) => {
            const d = formatDistance(c.summary.distanceM, unit);
            return (
              <button key={c.route.id} className="route-opt" role="radio" aria-checked={c.current} data-selected={c.current} onClick={() => (c.current ? cancel() : onChoose(c))}>
                <div className="route-opt-main">
                  <b className="num">{formatTripDuration(c.summary.durationS)}</b>
                  <span className="route-opt-tag" data-fastest={i === 0}>
                    {c.current ? t('nav.panel.current') : routeTagText(i, 0)}
                  </span>
                  <span className="num">
                    {d.value} {d.unit} · {formatClock(now + c.summary.durationS * 1000)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {alts.status !== 'idle' && alts.status !== 'loading' && (
        <button className="btn nav-panel-alt" onClick={cancel}>
          {t('nav.panel.cancel')}
        </button>
      )}
    </section>
  );
}
