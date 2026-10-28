import hu from '@atlagsebesseg/data/output/cameras.HU.json';
import { rowToCamera, type CameraRow, type FixedCamera } from './cameras';

/** Az appba csomagolt fix kamerák (tartalék, ha nincs szerver; a szerver-lista felülírja). */
export const BUNDLED_CAMERAS: readonly FixedCamera[] = ((hu as { cameras: unknown[] }).cameras as CameraRow[]).map(rowToCamera);
