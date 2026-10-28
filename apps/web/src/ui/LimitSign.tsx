import { speedIn, t, unitLabel, type SpeedUnit } from '@atlagsebesseg/app-logic';

/** KRESZ-tábla stílusú sebességhatár (a választott egységben); `null`: nincs adat → „–”. */
export function LimitSign({ kmh, unit, small }: { kmh: number | null; unit: SpeedUnit; small?: boolean }) {
  const shown = speedIn(kmh, unit);
  return (
    <div
      className={`sign num${small ? ' sm' : ''}`}
      aria-label={shown === null ? t('nav.limit.none') : t('hud.limitAria', { x: shown, u: unitLabel(unit) })}
    >
      {shown ?? '–'}
    </div>
  );
}
