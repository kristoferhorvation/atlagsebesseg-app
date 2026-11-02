import { HEAT_VIEWS, t, type HeatView } from '@atlagsebesseg/app-logic';

/** AW20: a hőtérkép módja a térképen – Gyakoriság | Átlagsebesség, alatta a színskála jelmagyarázata. Csak látható rétegnél jelenik meg. */
export function HeatSwitch({ view, onChange }: { view: HeatView; onChange: (v: HeatView) => void }) {
  const labels: Record<HeatView, string> = { gyakorisag: t('heat.view.frequency'), atlagsebesseg: t('heat.view.speed') };
  return (
    <div className="heat-switch" data-testid="heat-switch" data-view={view}>
      <div className="segmented glass" role="group" aria-label={t('heat.view.aria')}>
        {HEAT_VIEWS.map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => onChange(v)}>
            {labels[v]}
          </button>
        ))}
      </div>
      <div className="heat-legend" data-view={view}>
        <span className="heat-legend-bar" />
        <span className="heat-legend-text">{view === 'gyakorisag' ? t('heat.legend.frequency') : t('heat.legend.speed')}</span>
      </div>
    </div>
  );
}
