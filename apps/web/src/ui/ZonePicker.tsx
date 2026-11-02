import { t, ZONE_RADII, type HeatZone, type Settings } from '@atlagsebesseg/app-logic';

const LABEL: Record<number, 'heat.zone.200' | 'heat.zone.500' | 'heat.zone.1000'> = { 200: 'heat.zone.200', 500: 'heat.zone.500', 1000: 'heat.zone.1000' };

/** AW20-javítás: az adatvédelmi zóna sugara egy mentett helyhez – 200 m / 500 m / 1 km (alap 500 m). */
export function ZonePicker({ zone, name, update, settings, onShow }: { zone: HeatZone; name: string; settings: Settings; update: (p: Partial<Settings>) => void; onShow: (z: HeatZone) => void }) {
  const set = (r: number) => {
    update({ zona_m: { ...settings.zona_m, [zone.id]: r } });
    onShow({ ...zone, radiusM: r });
    // a lap lejjebb húzódik: a választó maradjon látható
    setTimeout(() => document.querySelector(`.zone-picker[data-zone="${zone.id}"]`)?.scrollIntoView({ block: 'nearest' }), 350);
  };
  return (
    <div className="zone-picker" data-testid="zone-picker" data-zone={zone.id}>
      <div className="hint">{t('heat.zone.label')}</div>
      <div className="segmented" role="group" aria-label={`${t('heat.zone.label')} – ${name}`}>
        {ZONE_RADII.map((r) => (
          <button key={r} aria-pressed={zone.radiusM === r} onClick={() => set(r)}>
            {t(LABEL[r]!)}
          </button>
        ))}
      </div>
    </div>
  );
}
