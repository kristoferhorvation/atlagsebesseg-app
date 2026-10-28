import type { CameraType } from '@atlagsebesseg/app-logic';
import type { IconName } from './Icon';

const ICON: Record<CameraType, IconName> = { speed: 'cam_speed', red_light: 'cam_light', complex: 'cam_complex', section_gate: 'kapu_kezdo' };

/** Kamera-típus → ikon (a térképen és a kártyán ugyanaz). */
export const cameraIcon = (t: CameraType): IconName => ICON[t];
