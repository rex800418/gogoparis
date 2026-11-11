/* Bump VERSION whenever app-shell files or the SDK URL change. */
const VERSION = "v1";
const CACHE_PREFIX = `repair-pwa:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SDK_URL =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
const SHELL_PATHS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./pwa.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];
const shellUrls = SHELL_PATHS.map(
  (path) => new URL(path, self.registration.scope).href,
);
const indexUrl = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // A failed shell download must not replace a working offline version.
      await cache.addAll(
        shellUrls.map((url) => new Request(url, { cache: "reload" })),
      );
      // CDN failure must not prevent the local shell from being available offline.
      try {
        await cache.add(
          new Request(SDK_URL, { mode: "cors", cache: "reload" }),
        );
      } catch {
        // The page explains a missing SDK; never fake a successful repair submission.
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // No Supabase records, form submissions, documents or unrelated sites are cached.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const isShell = shellUrls.includes(url.href);
  const isSdk = url.href === SDK_URL;
  if (!isShell && !isSdk) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (request.mode === "navigate") {
        // Serve the active version consistently until the user accepts an update.
        return (await cache.match(indexUrl)) || fetch(request);
      }
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque")
        await cache.put(request, response.clone());
      return response;
    })(),
  );
});
