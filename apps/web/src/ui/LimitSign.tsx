import { speedIn, type SpeedUnit } from '@atlagsebesseg/app-logic';

/** KRESZ-tábla stílusú sebességhatár (a választott egységben). */
export function LimitSign({ kmh, unit, small }: { kmh: number; unit: SpeedUnit; small?: boolean }) {
  return (
    <div className={`sign num${small ? ' sm' : ''}`} aria-label={`Határ: ${speedIn(kmh, unit)} ${unit === 'mph' ? 'mph' : 'km/h'}`}>
      {speedIn(kmh, unit)}
    </div>
  );
}
