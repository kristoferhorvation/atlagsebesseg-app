/** Egységes, 24 × 24-es vonalikonok (stroke 2, kerek végek). */
export const PATHS = {
  report: ['M12 3.5 2.8 19.5h18.4L12 3.5z', 'M12 10v4', 'M12 17v.01'],
  stopwatch: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 9v4l2.5 2', 'M9.5 2.5h5', 'M19 6.5l1.5-1.5'],
  sliders: ['M4 7h9', 'M19 7h1', 'M16 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M4 17h3', 'M13 17h7', 'M10 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  rendorseg: ['M12 3l7.5 3v5.5c0 4.6-3.1 8.2-7.5 9.9-4.4-1.7-7.5-5.3-7.5-9.9V6L12 3z', 'M12 8.5l1.1 2.3 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z'],
  traffipax: ['M3 9.5A2.5 2.5 0 0 1 5.5 7h13A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-7z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M8.5 7 10 4.5h4L15.5 7'],
  baleset: ['M4 17.5v-3l2-4.5h12l2 4.5v3', 'M3 17.5h18', 'M7.5 20a1.5 1.5 0 1 0 0-3', 'M16.5 20a1.5 1.5 0 1 1 0-3', 'M12 2.5v3', 'M6.5 4.5 8 6.5', 'M17.5 4.5 16 6.5'],
  akadaly: ['M10 3.5h4l5 16H5l5-16z', 'M7.7 12h8.6', 'M3.5 19.5h17'],
  utlezaras: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M7 12h10'],
  szakasz_hiba: ['M5 21V4', 'M5 4.5h12l-2.5 4 2.5 4H5'],
  kapu_kezdo: ['M4 20V5', 'M20 20V5', 'M4 5h16', 'M10.5 10.5v6l5-3z'],
  kapu_zaro: ['M4 20V5', 'M20 20V5', 'M4 5h16', 'M10 10.5h4.5v4.5H10z'],
  ideiglenes_szakasz: ['M4 20V5', 'M20 20V5', 'M4 5h16', 'M10.5 10.5v6l5-3z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  approx: ['M5 9.5c2.3-2 4.7-2 7 0s4.7 2 7 0', 'M5 15c2.3-2 4.7-2 7 0s4.7 2 7 0'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  arrowDown: ['M12 5v14', 'M6 13l6 6 6-6'],
  pause: ['M9 5.5v13', 'M15 5.5v13'],
  play: ['M7.5 5v14l11-7z'],
  stop: ['M7 7h10v10H7z'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  gps: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 19.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z', 'M12 2v2.5', 'M12 19.5V22', 'M2 12h2.5', 'M19.5 12H22'],
  screen: ['M7.5 2.5h9A1.5 1.5 0 0 1 18 4v16a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V4a1.5 1.5 0 0 1 1.5-1.5z', 'M10.5 18.5h3'],
  tunnel: ['M3 20v-7a9 9 0 0 1 18 0v7', 'M3 20h18', 'M9 20v-5a3 3 0 0 1 6 0v5'],
  approach: ['M12 21V9', 'M7 13l5-5 5 5', 'M5 3.5h14'],
  restart: ['M4 12a8 8 0 1 0 2.5-5.8', 'M4 4v4.5h4.5'],
  // fix kamerák (A7): oszlopra szerelt kamera, jelzőlámpa, kamera + lámpa
  cam_speed: ['M3 5.5h11.5v6.5H3z', 'M14.5 7.5 20 5.5v7.5l-5.5-2', 'M8.5 12v8.5', 'M5.5 20.5h6'],
  cam_light: ['M9.5 2.5h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2z', 'M12 7.2v.01', 'M12 10.5v.01', 'M12 13.8v.01', 'M12 18.5v3'],
  cam_complex: ['M2.5 5.5h10v5.5h-10z', 'M12.5 7.2 17 5.6v6.3l-4.5-1.6', 'M7.5 11v9.5', 'M4.5 20.5h6', 'M18 14h3.5v7H18z', 'M19.75 16.4v.01', 'M19.75 18.8v.01'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M16.2 16.2 21 21'],
  home: ['M3.5 11 12 4l8.5 7', 'M5.5 9.5V20h13V9.5', 'M10 20v-5.5h4V20'],
  work: ['M4 8h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M3 13h18'],
  pin: ['M12 21s6.5-5.8 6.5-11.2a6.5 6.5 0 0 0-13 0C5.5 15.2 12 21 12 21z', 'M12 12.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z'],
  crosshair: ['M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M12 2v4', 'M12 18v4', 'M2 12h4', 'M18 12h4', 'M12 12h.01'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  const filled = name === 'play' || name === 'stop';
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Ugyanaz az ikon SVG-szövegként – a térkép (nem React) jelölőinek. */
export function iconSvg(name: IconName, size = 24): string {
  const paths = PATHS[name].map((d) => `<path d="${d}"/>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
