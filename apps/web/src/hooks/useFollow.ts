import { useEffect, useReducer } from 'react';
import { FOLLOW_INITIAL, followReducer, type FollowEvent, type FollowState } from '@atlagsebesseg/app-logic';
import type { WebMapAdapter } from '../map';

/**
 * Követő kamera ki/be (app-logic `followReducer`): a térkép mozgatása kikapcsolja, a gomb
 * visszakapcsolja, mérés közben 5 s tétlenség után magától is visszaáll. Valós órával mér
 * (a tétlenség a felhasználó ideje, nem a szimulátoré).
 */
export function useFollow(map: WebMapAdapter, measuring: boolean) {
  const [state, dispatch] = useReducer((s: FollowState, e: FollowEvent) => followReducer(s, e), FOLLOW_INITIAL);
  useEffect(() => map.setHandlers({ onGesture: () => dispatch({ type: 'gesture', at: Date.now() }) }), [map]);
  useEffect(() => {
    if (state.following) return;
    const id = setInterval(() => dispatch({ type: 'tick', at: Date.now(), measuring }), 500);
    return () => clearInterval(id);
  }, [state.following, measuring]);
  useEffect(() => map.followUser(state.following), [map, state.following]);
  return { following: state.following, recenter: () => dispatch({ type: 'recenter' }) };
}
