import type { MapLook, Settings, SpeedUnit } from '@atlagsebesseg/app-logic';
import { DEFAULT_TOLERANCE } from '@atlagsebesseg/core';
import { Sheet } from './Sheet';

export interface SystemInfo {
  gps: string;
  wake: string;
  sections: string;
  server: string;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function SettingsSheet({
  settings,
  update,
  info,
  simMode,
  onClose,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  info: SystemInfo;
  simMode: boolean;
  onClose: () => void;
}) {
  const units: { id: SpeedUnit; label: string }[] = [
    { id: 'kmh', label: 'km/h' },
    { id: 'mph', label: 'mph' },
  ];
  const looks: { id: MapLook; label: string }[] = [
    { id: 'szines', label: 'színes' },
    { id: 'visszafogott', label: 'visszafogott' },
  ];
  return (
    <Sheet title="Beállítások" onClose={onClose}>
      <div className="group-label">Kijelző</div>
      <div className="list">
        <div className="list-row">
          <div>
            <div className="label">Hatósági tűrés megjelenítése</div>
            <div className="hint">
              A határ mellett a tűréssel növelt érték ({DEFAULT_TOLERANCE.percent}%, legalább {DEFAULT_TOLERANCE.minKmh} km/h). A
              színkód és a javaslat mindig a szigorú határhoz számol.
            </div>
          </div>
          <Switch
            label="Hatósági tűrés megjelenítése"
            checked={settings.hatosagi_tures_megjelenitese}
            onChange={(v) => update({ hatosagi_tures_megjelenitese: v })}
          />
        </div>
        <div className="list-row">
          <div className="label">Egység</div>
          <div className="segmented" role="group" aria-label="Egység">
            {units.map((u) => (
              <button key={u.id} aria-pressed={settings.egyseg === u.id} onClick={() => update({ egyseg: u.id })}>
                {u.label}
              </button>
            ))}
          </div>
        </div>
        <div className="list-row">
          <div className="label">Térkép</div>
          <div className="segmented" role="group" aria-label="Térkép">
            {looks.map((l) => (
              <button key={l.id} aria-pressed={settings.terkep === l.id} onClick={() => update({ terkep: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="group-label">Állapot</div>
      <div className="list">
        {(
          [
            ['GPS', info.gps],
            ['Kijelző ébren tartása', info.wake],
            ['Szakaszok', info.sections],
            ['Szerver', info.server],
          ] as const
        ).map(([k, v]) => (
          <div className="list-row" key={k}>
            <div className="label">{k}</div>
            <div className="value">{v}</div>
          </div>
        ))}
      </div>

      <div className="group-label">Fejlesztés</div>
      <div className="list">
        <a className="list-row" href={simMode ? '/' : '/?sim'}>
          <div>
            <div className="label">{simMode ? 'Kilépés a szimulátorból' : 'Szimulátor'}</div>
            <div className="hint">Felvett útvonal lejátszása GPS nélkül, a kijelző kipróbálásához.</div>
          </div>
        </a>
      </div>

      <div className="sheet-note">
        Szakaszadatok: © OpenStreetMap contributors (ODbL). Térkép: © Mapbox, © OpenStreetMap. Az app tájékoztató jellegű – a
        sebességhatárt mindig a táblák határozzák meg.
      </div>
    </Sheet>
  );
}
