import { useEffect, useState } from 'react';
import { HEAT_MODES, LANGUAGE_NAMES, LOCALES, MEGSZOLITAS_MAX, displayPlace, getLanguage, languageMenu, normalizeName, t, voiceInstructionsHint, type HeatMode, type HeatZone, type MapLook, type SavedPlaces, type Settings, type SpeedUnit } from '@atlagsebesseg/app-logic';
import { DEFAULT_TOLERANCE } from '@atlagsebesseg/core';
import { useLanguage, useVoiceStatus } from '../i18n';
import { purgeTrash, restoreTrash, trashExpiry } from '../trips/tripStore';
import type { AccountApi } from '../hooks/useAccount';
import { AccountCard, BackupRow, DeleteAccountRow, SignOutRow } from './AccountCard';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { ZonePicker } from './ZonePicker';

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
  onOpenTrips,
  onRestored,
  zones,
  onOpenHeatDetails,
  onShowZone,
  peek,
  onPeekEnd,
  onClose,
  account,
}: {
  /** AW22: a „Fiók” kártya a lap tetején. */
  account: AccountApi;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  info: SystemInfo;
  simMode: boolean;
  saved: SavedPlaces;
  onPickPlace: (kind: 'home' | 'work' | 'other') => void;
  onClearPlace: (kind: 'home' | 'work') => void;
  onRemoveOther: (id: string) => void;
  /** AW19: az utak naplója (a lap helyén nyílik). */
  onOpenTrips: () => void;
  /** AOS17: a törölt adatok visszaálltak (a napló és a hőtérkép újratöltése + visszajelzés). */
  onRestored: () => void;
  /** AW20-javítás: az adatvédelmi zónák (mentett helyenként), a Részletek lap és a zóna megmutatása a térképen. */
  zones: readonly HeatZone[];
  onOpenHeatDetails: () => void;
  onShowZone: (z: HeatZone) => void;
  /** A zóna-kör látványához a lap rövid időre lejjebb húzódik (`peek`), görgetésre / idő után vissza. */
  peek: boolean;
  onPeekEnd: () => void;
  onClose: () => void;
}) {
  const zoneOf = (id: string) => zones.find((z) => z.id === id);
  // AOS17: a „Törölt adatok visszaállítása” sor csak a lejáratig látszik
  const [trashUntil, setTrashUntil] = useState<number | null>(null);
  useEffect(() => {
    void purgeTrash()
      .then(() => trashExpiry())
      .then(setTrashUntil)
      .catch(() => setTrashUntil(null));
  }, []);
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
  const heatLabels: Record<HeatMode, string> = { ki: t('settings.heat.off'), sajat: t('settings.heat.own'), kozossegi: t('settings.heat.community') };
  return (
    <Sheet title={t('settings.title')} onClose={onClose} peek={peek} onPeekEnd={onPeekEnd}>
      <AccountCard account={account} settings={settings} update={update} />
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
        {/* AW20: hőtérkép (ki / saját / közösségi) és a névtelen adatmegosztás (alapból ki) */}
        <div className="list-row stacked">
          <div>
            <div className="label">{t('settings.heat')}</div>
            <div className="hint">{t('settings.heatHint')}</div>
          </div>
          <div className="segmented" role="group" aria-label={t('settings.heat')} data-testid="heat-mode">
            {HEAT_MODES.map((m) => (
              <button key={m} aria-pressed={settings.hoterkep === m} onClick={() => update({ hoterkep: m })}>
                {heatLabels[m]}
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
            {/* AW17: a hang elérhetősége zárójelben a leírás végén (a külön „Hang” sor megszűnt) */}
            <div className="hint" data-voice={voice}>
              {voiceInstructionsHint(voice)}
            </div>
          </div>
          <Switch label={t('settings.voiceInstructions')} checked={settings.hangos_utasitasok} onChange={(v) => update({ hangos_utasitasok: v })} />
        </div>
      </div>

      {/* AW19: az utak naplója – egy sor a Mentett helyek fölött */}
      <div className="list trips-entry">
        <button className="list-row nav-row" onClick={onOpenTrips}>
          <div className="label">{t('trips.title')}</div>
          <Icon name="chevronRight" size={20} />
        </button>
        {trashUntil !== null && (
          <button
            className="list-row nav-row"
            data-testid="trash-restore"
            onClick={() => void restoreTrash().then(() => {
              setTrashUntil(null);
              onRestored();
            })}
          >
            <div>
              <div className="label">{t('settings.restore')}</div>
              <div className="hint">{t('settings.restoreHint', { date: new Date(trashUntil).toLocaleDateString(LOCALES[getLanguage()], { year: 'numeric', month: 'long', day: 'numeric' }) })}</div>
            </div>
            <Icon name="chevronRight" size={20} />
          </button>
        )}
      </div>

      <div className="group-label">{t('settings.group.places')}</div>
      <div className="list">
        {(['home', 'work'] as const).map((kind) => (
          <div className="list-row" key={kind}>
            <div style={{ minWidth: 0 }}>
              <div className="label">{t(kind === 'home' ? 'nav.place.home' : 'nav.place.work')}</div>
              <div className="hint">{saved[kind] ? displayPlace(saved[kind]).name : t('nav.place.unset')}</div>
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
            {/* AOS17: a sor teljes szélességében, a gombok alatt – 320 px-en sem csúszik ki */}
            {zoneOf(kind) && <ZonePicker zone={zoneOf(kind)!} name={t(kind === 'home' ? 'nav.place.home' : 'nav.place.work')} settings={settings} update={update} onShow={onShowZone} />}
          </div>
        ))}
        {saved.others.map(displayPlace).map((p) => (
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
            {zoneOf(p.id) && <ZonePicker zone={zoneOf(p.id)!} name={p.name} settings={settings} update={update} onShow={onShowZone} />}
          </div>
        ))}
        <div className="list-row">
          <button className="mini-btn" onClick={() => onPickPlace('other')}>
            {t('nav.place.add')}
          </button>
        </div>
      </div>

      {/* AW24: Adatvédelem: a megosztás, a zónák részletei, a felhős mentés és legalul a fiók törlése */}
      <div className="group-label">{t('settings.group.privacy')}</div>
      <div className="list" data-testid="privacy-group">
        <div className="list-row">
          <div>
            <div className="label">{t('settings.share')}</div>
            <div className="hint">{t('settings.shareHint')}</div>
          </div>
          <Switch label={t('settings.share')} checked={settings.adatmegosztas} onChange={(v) => update({ adatmegosztas: v })} />
        </div>
        <button className="list-row nav-row" data-testid="heat-details-row" onClick={onOpenHeatDetails}>
          <div className="label">{t('settings.shareDetails')}</div>
          <Icon name="chevronRight" size={20} />
        </button>
        {/* AW25: az adatvédelmi tájékoztató az app nyelvén (public/legal, a docs/legal-ból generálva) */}
        <a className="list-row nav-row" data-testid="privacy-policy-row" href={`/legal/privacy.${getLanguage()}.html`} target="_blank" rel="noopener">
          <div className="label">{t('settings.privacyPolicy')}</div>
          <Icon name="chevronRight" size={20} />
        </a>
        <BackupRow account={account} settings={settings} update={update} />
        <DeleteAccountRow account={account} />
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
      <SignOutRow account={account} />
    </Sheet>
  );
}
