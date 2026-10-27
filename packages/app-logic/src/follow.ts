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
