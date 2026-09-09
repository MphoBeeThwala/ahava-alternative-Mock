// Ahava PWA service worker.
//
// Deliberately conservative: this app is cookie-session-authenticated and
// every meaningful read/write goes through /api/*, which carries PHI. This
// worker NEVER intercepts /api/* or any non-GET request — those always hit
// the network exactly as if no service worker were installed. It only:
//   1. Cache-first serves same-origin static assets (JS/CSS/fonts/icons —
//      Next.js content-hashes these, so caching them aggressively is safe
//      and makes repeat loads fast/offline-capable).
//   2. Network-first serves page navigations, falling back to a small
//      static "you're offline" page if the network is unreachable.
// Bump CACHE_NAME to invalidate old caches on the next deploy.
const CACHE_NAME = "ahava-static-v1";
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|ico)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never touch writes

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin
  if (url.pathname.startsWith("/api/")) return; // never cache PHI/session traffic

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
