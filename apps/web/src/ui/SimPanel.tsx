import { useState } from 'react';
import { SCENARIOS } from '../sim/scenarios';
import { SIM_SPEEDS, type Simulator } from '../sim/useSimulator';
import { Icon } from './Icon';

/** Fejlesztői vezérlő: útvonal, forgatókönyv, sebesség, lejátszás, háttérbe kerülés. */
export function SimPanel({ sim, onBackground }: { sim: Simulator; onBackground: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open)
    return (
      <div className="sim collapsed">
        <button className="pill" data-tone="kezi" onClick={() => setOpen(true)}>
          <Icon name="play" size={16} /> Szim.
        </button>
      </div>
    );
  return (
    <div className="sim glass">
      <div className="sim-head">
        <span>Szimulátor</span>
        <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setOpen(false)} aria-label="Összecsukás">
          <Icon name="close" size={16} />
        </button>
      </div>
      <select value={sim.route.id} onChange={(e) => sim.setRouteId(e.target.value)} aria-label="Útvonal">
        {sim.routes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <div className="sim-chips" role="group" aria-label="Forgatókönyv">
        {SCENARIOS.map((s) => (
          <button key={s.id} aria-pressed={sim.scenario === s.id} onClick={() => sim.setScenario(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="sim-chips">
        <button aria-pressed={false} onClick={() => sim.setPlaying(!sim.playing)}>
          {sim.playing ? 'Szünet' : 'Lejátszás'}
        </button>
        <button aria-pressed={false} onClick={sim.restart}>
          Elölről
        </button>
        {SIM_SPEEDS.map((v) => (
          <button key={v} aria-pressed={sim.speed === v} onClick={() => sim.setSpeed(v)}>
            {v}×
          </button>
        ))}
        <button aria-pressed={false} onClick={onBackground} title="Mintha az app háttérbe kerülne">
          Háttérbe
        </button>
      </div>
      <div className="sim-bar">
        <i style={{ transform: `scaleX(${sim.progress})` }} />
      </div>
    </div>
  );
}
