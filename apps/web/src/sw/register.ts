/**
 * Service worker csak éles buildben (fejlesztés közben a cache zavarná a HMR-t). AW23: a háttérben nyitva hagyott lap (telefon) a régi
 * kódot futtatta új kiadás után is: visszatéréskor kér frissítést, és az új verzióra újratölt, ha épp nem megy navigáció vagy mérés.
 */
export function registerServiceWorker(busy: () => boolean = () => false): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    const hadController = navigator.serviceWorker.controller !== null;
    let updated = false;
    const reloadIfIdle = () => {
      if (updated && document.visibilityState === 'visible' && !busy()) location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // az első telepítés nem új verzió
      if (!hadController) return;
      updated = true;
      reloadIfIdle();
    });
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          void reg.update().catch(() => undefined);
          reloadIfIdle();
        });
        // vezetés után is frissüljön, ne csak a következő visszatéréskor
        setInterval(reloadIfIdle, 60_000);
      })
      .catch(() => undefined);
  });
}
