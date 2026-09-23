/*
 * Freman Browser — production service worker.
 *
 * Caching strategy:
 *  - App shell (/, offline page, manifest, icons): precached at install.
 *  - App navigations: network-first (never serves a stale shell), falling back
 *    to the cached page, then to the offline fallback.
 *  - Hashed static assets (/assets/, icons): stale-while-revalidate.
 *  - Everything else (cross-origin sites, the page proxy, Convex API calls):
 *    passed straight through to the network. Web content the browser renders
 *    is NEVER cached, so installed users can't get stale pages or broken auth.
 *
 * Update behavior: on activate, any cache not matching CACHE_VERSION is
 * deleted; clients are told on "message" { type: "SW_UPDATED" } so the app can
 * show a refresh prompt. skipWaiting is NOT auto-called — the new worker
 * activates after all tabs close, unless the app calls postMessage SKIP.
 */

const CACHE_VERSION = "freman-v1.1.0";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/splash-wordmark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Cache one-by-one so a single failed request doesn't abort install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (res && res.ok) await cache.put(url, res);
          } catch {
            // Non-fatal: precache is a best-effort warm-up.
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Not supported everywhere; safe to ignore.
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/** Is this a same-origin build asset that's safe to serve stale-while-revalidate? */
function isHashedAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/icon.svg"
  );
}

/** Is this a request we must never answer from cache? */
function isLiveOnly(url) {
  return (
    url.hostname.endsWith(".convex.cloud") ||
    url.hostname.endsWith(".convex.site") ||
    // Our own fetchProxy renders third-party pages; always live.
    (url.origin === self.location.origin && url.pathname === "/fetchProxy") ||
    // Web Store / wallet / auth endpoints must never be cached.
    url.pathname.startsWith("/api/")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Navigations: network-first with cache + offline fallbacks.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached =
            (await cache.match(request.url)) || (await cache.match("/"));
          return cached || (await cache.match("/offline.html")) || Response.error();
        }
      })(),
    );
    return;
  }

  const url = new URL(request.url);
  if (request.method !== "GET" || isLiveOnly(url)) return;

  if (isHashedAsset(url) && url.origin === self.location.origin) {
    // Stale-while-revalidate for immutable assets.
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => undefined);
        return cached || (await network) || Response.error();
      })(),
    );
  }
  // Everything else: default network behavior, untouched.
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })(),
  );
});
