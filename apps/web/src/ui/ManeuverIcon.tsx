import type { ManeuverIcon as Kind } from '@atlagsebesseg/app-logic';

/** A manőver-ikonok vonalrajzai (24 × 24, az autó lentről halad felfelé); az iOS-generátor is innen olvassa (A11). */
export const MANEUVER_PATHS: Record<Kind, readonly string[]> = {
  straight: ['M12 21V5', 'M7 10l5-5 5 5'],
  depart: ['M12 21V5', 'M7 10l5-5 5 5'],
  right: ['M8 21v-8a4 4 0 0 1 4-4h6', 'M15 5.5 18.5 9 15 12.5'],
  left: ['M16 21v-8a4 4 0 0 0-4-4H6', 'M9 5.5 5.5 9 9 12.5'],
  slight_right: ['M10 21v-6l7-7', 'M11 8h6v6'],
  slight_left: ['M14 21v-6L7 8', 'M13 8H7v6'],
  sharp_right: ['M8 21V8l9 9', 'M17 11v6h-6'],
  sharp_left: ['M16 21V8l-9 9', 'M7 11v6h6'],
  uturn: ['M7 21V9a5 5 0 0 1 10 0v9', 'M13.5 15.5 17 19l3.5-3.5'],
  roundabout_right: ['M12 21v-5', 'M12 16a4 4 0 1 1 4-4', 'M15 8l4-4', 'M15 4h4v4'],
  roundabout_left: ['M12 21v-5', 'M12 16a4 4 0 1 0-4-4', 'M9 8 5 4', 'M9 4H5v4'],
  merge: ['M7 21c0-6 5-6 5-10V5', 'M17 21c0-6-5-6-5-10', 'M8 9l4-4 4 4'],
  fork_left: ['M12 21v-7l-5-5', 'M7 14V9h5', 'M12 14l4-4'],
  fork_right: ['M12 21v-7l5-5', 'M17 14V9h-5', 'M12 14l-4-4'],
  arrive: ['M12 21s6-5.5 6-11a6 6 0 0 0-12 0c0 5.5 6 11 6 11z', 'M12 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z'],
};

export function ManeuverIcon({ kind, size = 56 }: { kind: Kind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {MANEUVER_PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
