// =============================================================================
// sw.js — service worker: keeps a copy of the website for offline use
// -----------------------------------------------------------------------------
// tools/build.mjs fills in CACHE (changes whenever any file changes) and FILES
// (every file of the site except the downloads). On the first visit the
// browser saves them all, so the apps also open with no internet.
//
// Pages (the apps and the home page) come from the network first, so a new
// version shows on the next load. The saved copy is used when the network
// fails or takes longer than NETWORK_WAIT_MS. Icons and images come from the
// saved copy first. A new build gets a new CACHE name and deletes the old copy.
// =============================================================================
const CACHE = '__CACHE__';
const FILES = __FILES__;
const NETWORK_WAIT_MS = 4000;   // slow network: open the saved copy after this

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's own short-term cache, so a new
  // version never saves an older file
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mlab-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') e.respondWith(pageNetworkFirst(e));
  else e.respondWith(savedFirst(req));
});

/** Icons, images, manifests: saved copy first; anything not saved (the downloads) from the network. */
async function savedFirst(req) {
  const cache = await caches.open(CACHE);
  return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
}

/** Pages: the newest version from the network; the saved copy when offline or slow. */
async function pageNetworkFirst(e) {
  const req = e.request;
  const cache = await caches.open(CACHE);
  const key = req.url.split(/[?#]/)[0];
  const fresh = fetch(key, { cache: 'no-cache' }).then((res) => {
    if (res.ok && !res.redirected) cache.put(key, res.clone());   // keep the saved copy up to date
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));   // finish saving even if the saved copy was shown
  try {
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NETWORK_WAIT_MS));
    const res = await Promise.race([fresh, slow]);
    if (res.ok && !res.redirected) return res;
  } catch { /* offline or slow: use the saved copy */ }
  // saved copy; otherwise let the browser load it normally (redirects, missing pages)
  return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
}
