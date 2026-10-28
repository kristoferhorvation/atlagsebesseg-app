import { speedIn, t, unitLabel, type SpeedUnit } from '@atlagsebesseg/app-logic';

/** KRESZ-tábla stílusú sebességhatár (a választott egységben). */
export function LimitSign({ kmh, unit, small }: { kmh: number; unit: SpeedUnit; small?: boolean }) {
  return (
    <div className={`sign num${small ? ' sm' : ''}`} aria-label={t('hud.limitAria', { x: speedIn(kmh, unit) ?? '', u: unitLabel(unit) })}>
      {speedIn(kmh, unit)}
    </div>
  );
}
