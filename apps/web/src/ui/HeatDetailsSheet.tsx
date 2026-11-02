import { t, type HeatZone, type SavedPlaces, type Settings } from '@atlagsebesseg/app-logic';
import { Sheet } from './Sheet';
import { ZonePicker } from './ZonePicker';

/** AW20-javítás: a „Névtelen vezetési adatok megosztása” részletei – mi megy fel, mi nem, a védett zónák és beállításuk. */
export function HeatDetailsSheet({ saved, zones, settings, update, onShowZone, peek, onPeekEnd, onClose }: { saved: SavedPlaces; zones: readonly HeatZone[]; settings: Settings; update: (p: Partial<Settings>) => void; onShowZone: (z: HeatZone) => void; peek: boolean; onPeekEnd: () => void; onClose: () => void }) {
  const nameOf = (id: string) => (id === 'home' ? t('nav.place.home') : id === 'work' ? t('nav.place.work') : saved.others.find((p) => p.id === id)?.name ?? id);
  return (
    <Sheet title={t('heat.details.title')} onClose={onClose} peek={peek} onPeekEnd={onPeekEnd}>
      <div className="heat-details" data-testid="heat-details">
        <div className="group-label">{t('heat.details.up.title')}</div>
        <div className="sheet-note">{t('heat.details.up.body')}</div>
        <div className="group-label">{t('heat.details.no.title')}</div>
        <div className="sheet-note">{t('heat.details.no.body')}</div>
        <div className="group-label">{t('heat.details.zones.title')}</div>
        <div className="sheet-note">{t('heat.details.zones.body')}</div>
        <div className="list">
          {zones.length === 0 && (
            <div className="list-row">
              <div className="hint">{t('heat.details.noPlaces')}</div>
            </div>
          )}
          {zones.map((z) => (
            <div className="list-row stacked" key={z.id}>
              <div className="label">{nameOf(z.id)}</div>
              <ZonePicker zone={z} name={nameOf(z.id)} settings={settings} update={update} onShow={onShowZone} />
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
