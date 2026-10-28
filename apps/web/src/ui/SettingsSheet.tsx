import { LANGUAGES, LANGUAGE_NAMES, t, type MapLook, type Settings, type SpeedUnit } from '@atlagsebesseg/app-logic';
import { DEFAULT_TOLERANCE } from '@atlagsebesseg/core';
import { useLanguage, useVoiceStatus } from '../i18n';
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
  const { lang, preference, setPreference } = useLanguage();
  const voice = useVoiceStatus(lang);
  const units: { id: SpeedUnit; label: string }[] = [
    { id: 'kmh', label: 'km/h' },
    { id: 'mph', label: 'mph' },
  ];
  const looks: { id: MapLook; label: string }[] = [
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
        <div className="list-row">
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
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
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

      <div className="group-label">{t('settings.group.status')}</div>
      <div className="list">
        {(
          [
            [t('settings.gps'), info.gps],
            [t('settings.wake'), info.wake],
            [t('settings.sections'), info.sections],
            [t('settings.server'), info.server],
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
