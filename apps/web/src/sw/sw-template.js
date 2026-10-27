// Service worker – build-időben generált (vite.config.ts → serviceWorker). Csak az app shellt
// cache-eli; a Mapbox-csempék, a Mapbox API és a Supabase (más origin) érintetlenül mennek át.
const VERSION = '__VERSION__';
const CACHE = `atlag-shell-${VERSION}`;
const SHELL = __SHELL__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('atlag-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // térkép-csempék, API-k: nincs cache

  // Navigáció: hálózat először (friss verzió), offline a cache-elt shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/', { cacheName: CACHE }).then((r) => r ?? Response.error())),
    );
    return;
  }
  // Hash-elt assetek, ikonok, betűk: cache először.
  event.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit ?? fetch(req)));
});
