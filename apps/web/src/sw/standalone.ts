/** Kezdőképernyőről indítva-e (iOS `navigator.standalone`, egyébként a manifest `display` módja). */
export function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
}

/** AW24: a `.app` magassága a kirajzolt nézetablak (styles.css); eszköztár-váltáskor, forgatáskor és kezdőképernyős indítás után frissül. */
export function trackAppHeight(): void {
  const set = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
  set();
  window.addEventListener('resize', set);
  visualViewport?.addEventListener('resize', set);
}

/** Az app magassága (px). */
export const appHeight = (): number => document.querySelector('.app')?.clientHeight ?? window.innerHeight;
