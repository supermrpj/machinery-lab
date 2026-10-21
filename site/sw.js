// =============================================================================
// sw.js — service worker: keeps a copy of the website for offline use
// -----------------------------------------------------------------------------
// tools/build.mjs fills in CACHE (changes whenever any file changes) and FILES
// (every file of the site except the downloads). On the first visit the
// browser saves them all; after that the apps open from the saved copy, even
// with no internet. A new build gets a new CACHE name, so the next visit
// downloads the new version once and deletes the old copy.
// =============================================================================
const CACHE = '__CACHE__';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mlab-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// saved copy first; anything not saved (the downloads) comes from the network
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE)
    .then((c) => c.match(req, { ignoreSearch: true }))
    .then((hit) => hit || fetch(req)));
});
