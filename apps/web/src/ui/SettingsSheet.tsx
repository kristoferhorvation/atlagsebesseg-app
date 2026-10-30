import { LANGUAGE_NAMES, languageMenu, t, type MapLook, type SavedPlaces, type Settings, type SpeedUnit } from '@atlagsebesseg/app-logic';
import { DEFAULT_TOLERANCE } from '@atlagsebesseg/core';
import { useLanguage, useVoiceStatus } from '../i18n';
import { Sheet } from './Sheet';

export interface SystemInfo {
  gps: string;
  wake: string;
  sections: string;
  server: string;
  /** A mai útvonal-kérések száma. */
  requests: string;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function SettingsSheet({
  settings,
  update,
  info,
  simMode,
  saved,
  onPickPlace,
  onClearPlace,
  onRemoveOther,
  onClose,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  info: SystemInfo;
  simMode: boolean;
  saved: SavedPlaces;
  onPickPlace: (kind: 'home' | 'work' | 'other') => void;
  onClearPlace: (kind: 'home' | 'work') => void;
  onRemoveOther: (id: string) => void;
  onClose: () => void;
}) {
  const { lang, preference, setPreference } = useLanguage();
  const voice = useVoiceStatus(lang);
  const units: { id: SpeedUnit; label: string }[] = [
    { id: 'kmh', label: 'km/h' },
    { id: 'mph', label: 'mph' },
  ];
  const looks: { id: MapLook; label: string }[] = [
    { id: 'vilagos', label: t('settings.look.light') },
    { id: 'szines', label: t('settings.look.color') },
    { id: 'visszafogott', label: t('settings.look.muted') },
  ];
  return (
    <Sheet title={t('settings.title')} onClose={onClose}>
      <div className="group-label">{t('settings.group.display')}</div>
      <div className="list">
        <div className="list-row">
          <div>
            <div className="label">{t('settings.tolerance')}</div>
            <div className="hint">{t('settings.toleranceHint', { percent: DEFAULT_TOLERANCE.percent, min: DEFAULT_TOLERANCE.minKmh })}</div>
          </div>
          <Switch
            label={t('settings.tolerance')}
            checked={settings.hatosagi_tures_megjelenitese}
            onChange={(v) => update({ hatosagi_tures_megjelenitese: v })}
          />
        </div>
        <div className="list-row">
          <div className="label">{t('settings.unit')}</div>
          <div className="segmented" role="group" aria-label={t('settings.unit')}>
            {units.map((u) => (
              <button key={u.id} aria-pressed={settings.egyseg === u.id} onClick={() => update({ egyseg: u.id })}>
                {u.label}
              </button>
            ))}
          </div>
        </div>
        <div className="list-row">
          <div>
            <div className="label">{t('settings.planned')}</div>
            <div className="hint">{t('settings.plannedHint')}</div>
          </div>
          <Switch label={t('settings.planned')} checked={settings.tervezett_meresek} onChange={(v) => update({ tervezett_meresek: v })} />
        </div>
        <div className="list-row stacked">
          <div className="label">{t('settings.map')}</div>
          <div className="segmented" role="group" aria-label={t('settings.map')}>
            {looks.map((l) => (
              <button key={l.id} aria-pressed={settings.terkep === l.id} onClick={() => update({ terkep: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="list-row">
          <div className="label">{t('settings.language')}</div>
          <select
            className="select"
            aria-label={t('settings.language')}
            value={preference}
            onChange={(e) => setPreference(e.target.value as typeof preference)}
          >
            <option value="auto">{t('settings.language.auto')} ({LANGUAGE_NAMES[lang]})</option>
            {/* AW15: zászló + a saját nyelvén írt név, ábécérendben; az „Automatikus” legfelül */}
            {languageMenu().map((l) => (
              <option key={l.lang} value={l.lang}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="list-row">
          <div>
            <div className="label">{t('settings.voiceInstructions')}</div>
            <div className="hint">{t('settings.voiceInstructionsHint')}</div>
          </div>
          <Switch label={t('settings.voiceInstructions')} checked={settings.hangos_utasitasok} onChange={(v) => update({ hangos_utasitasok: v })} />
        </div>
        <div className="list-row">
          <div>
            <div className="label">{t('settings.voice')}</div>
            <div className="hint" data-voice={voice}>
              {t(voice === 'ok' ? 'settings.voice.ok' : voice === 'missing' ? 'settings.voice.missing' : 'settings.voice.unsupported')}
            </div>
          </div>
        </div>
      </div>

      <div className="group-label">{t('settings.group.places')}</div>
      <div className="list">
        {(['home', 'work'] as const).map((kind) => (
          <div className="list-row" key={kind}>
            <div style={{ minWidth: 0 }}>
              <div className="label">{t(kind === 'home' ? 'nav.place.home' : 'nav.place.work')}</div>
              <div className="hint">{saved[kind]?.name ?? t('nav.place.unset')}</div>
            </div>
            <div className="mini-btns">
              <button className="mini-btn" onClick={() => onPickPlace(kind)}>
                {t('nav.place.set')}
              </button>
              {saved[kind] && (
                <button className="mini-btn" onClick={() => onClearPlace(kind)}>
                  {t('nav.place.remove')}
                </button>
              )}
            </div>
          </div>
        ))}
        {saved.others.map((p) => (
          <div className="list-row" key={p.id}>
            <div style={{ minWidth: 0 }}>
              <div className="label">{p.name}</div>
              {p.address && <div className="hint">{p.address}</div>}
            </div>
            <div className="mini-btns">
              <button className="mini-btn" onClick={() => onRemoveOther(p.id)}>
                {t('nav.place.remove')}
              </button>
            </div>
          </div>
        ))}
        <div className="list-row">
          <button className="mini-btn" onClick={() => onPickPlace('other')}>
            {t('nav.place.add')}
          </button>
        </div>
      </div>

      <div className="group-label">{t('settings.group.status')}</div>
      <div className="list">
        {(
          [
            [t('settings.gps'), info.gps],
            [t('settings.wake'), info.wake],
            [t('settings.sections'), info.sections],
            [t('settings.server'), info.server],
            [t('settings.requests'), info.requests],
          ] as const
        ).map(([k, v]) => (
          <div className="list-row" key={k}>
            <div className="label">{k}</div>
            <div className="value">{v}</div>
          </div>
        ))}
      </div>

      <div className="group-label">{t('settings.group.dev')}</div>
      <div className="list">
        <a className="list-row" href={simMode ? '/' : '/?sim'}>
          <div>
            <div className="label">{simMode ? t('settings.sim.exit') : t('settings.sim.enter')}</div>
            <div className="hint">{t('settings.sim.hint')}</div>
          </div>
        </a>
      </div>

      <div className="sheet-note">{t('settings.attribution')}</div>
    </Sheet>
  );
}
