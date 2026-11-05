/** Kezdőképernyőről indítva-e (iOS `navigator.standalone`, egyébként a manifest `display` módja). */
export function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
}

/** AW23: standalone módban az app a teljes kijelzőt tölti ki, az alsó rendszercsíkig (a `.app` magassága, styles.css). */
export function applyStandaloneHeight(): void {
  if (!isStandalone()) return;
  const set = () => document.documentElement.style.setProperty('--app-h', `${Math.max(screen.height, window.innerHeight)}px`);
  set();
  window.addEventListener('resize', set);
}

/** Az app magassága (px): a `window.innerHeight` standalone módban rövidebb lehet a kijelzőnél. */
export const appHeight = (): number => document.querySelector('.app')?.clientHeight ?? window.innerHeight;
