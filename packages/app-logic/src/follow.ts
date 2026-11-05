import { camera } from '@atlagsebesseg/design-tokens';

/** Mérés közben ennyi tétlenség után a kamera magától visszaáll a követésre. */
export const FOLLOW_RESUME_MS = 5000;

/** A követő kamera állapota: követ, vagy a felhasználó elmozgatta a térképet. */
export interface FollowState {
  following: boolean;
  /** Az utolsó felhasználói térkép-mozdulat ideje (ms). */
  lastGestureAt: number;
}

export type FollowEvent =
  /** Húzás, csípés, forgatás (a mozdulat minden lépése frissíti a tétlenség kezdetét). */
  | { type: 'gesture'; at: number }
  /** „Vissza a helyemre” gomb. */
  | { type: 'recenter' }
  /** Óra: `measuring` igaz, ha mérés fut (szakasz vagy kézi). */
  | { type: 'tick'; at: number; measuring: boolean };

export const FOLLOW_INITIAL: FollowState = { following: true, lastGestureAt: 0 };

/**
 * Követés ki/be: a felhasználói mozdulat kikapcsolja; a gomb visszakapcsolja; mérés közben
 * 5 s tétlenség után magától is visszaáll, mérésen kívül csak a gombra.
 */
export function followReducer(s: FollowState, e: FollowEvent, resumeMs = FOLLOW_RESUME_MS): FollowState {
  switch (e.type) {
    case 'gesture':
      return { following: false, lastGestureAt: e.at };
    case 'recenter':
      return s.following ? s : { ...s, following: true };
    case 'tick':
      return !s.following && e.measuring && e.at - s.lastGestureAt >= resumeMs ? { ...s, following: true } : s;
  }
}

/** AW23: a követő zoom a sebességből (km/h), minden állapotban: a `camera.zoomStops` között lineáris, a széleken állandó. */
export function followZoom(kmh: number, stops = camera.zoomStops): number {
  const v = Number.isFinite(kmh) ? Math.max(0, kmh) : 0;
  const first = stops[0]!;
  if (v <= first[0]) return first[1];
  for (let i = 1; i < stops.length; i++) {
    const [s1, z1] = stops[i]!;
    const [s0, z0] = stops[i - 1]!;
    if (v <= s1) return z0 + ((v - s0) / (s1 - s0)) * (z1 - z0);
  }
  return stops.at(-1)![1];
}

/** AW23: a jelölő helye a képernyőn (0 = fent, 1 = lent): a legfelső alsó kártya fölött `focusGap`-pel, a sávon belül; minden állapotban ugyanez. */
export function followFocusY(cardTop: number, screenH: number): number {
  return Math.max(camera.focusMinY, Math.min(camera.focusMaxY, (cardTop - camera.focusGap) / screenH));
}
