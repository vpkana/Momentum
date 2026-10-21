/* Momentum service worker — offline-first app shell.
 *
 * Goal: the app is fully functional offline after installation + one online
 * visit. It has no backend — every request this worker handles is a static
 * asset or a Next.js document/RSC payload on the same origin.
 *
 * Strategy:
 *  - On activation, the whole app is pre-cached: the HTML of every route,
 *    the JS/CSS chunks each document references (plus the font files those
 *    stylesheets point at) and each route's RSC payload. After this warm-up
 *    the five screens work offline without ever having been visited.
 *  - Navigations (documents): network-first, falling back to the cached copy
 *    of that exact page, then the cached home shell. Successful loads are
 *    cached as they happen.
 *  - RSC requests (client-side route transitions): network-first with a cache
 *    fallback, stored under a distinct key so it never collides with the
 *    document HTML.
 *  - Hashed build assets (_next/static, fonts, icons, manifest): cache-first
 *    with a background refresh (stale-while-revalidate) — hashed URLs are
 *    immutable so this is always safe.
 */
const VERSION = "momentum-shell-v3";
const RSC_QUERY = "?momentum_rsc=1";
const ROUTES = ["/", "/remainder", "/occasional", "/calendar", "/profile", "/section"];
const STATIC_PREFIXES = ["/_next/static/", "/icons/", "/fonts/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-512.png", "/icons/icon-192.png", "/icon.svg"]).catch(() => {}),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))),
  );
  // Control open pages immediately, then warm the full offline app in the
  // background without delaying activation.
  event.waitUntil(self.clients.claim());
  event.waitUntil(warmApp());
});

const sameOrigin = (url) => url.origin === self.location.origin;

/** Cache-first with background refresh for immutable, hashed assets. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await refresh);
}

/** Network-first document fetch that keeps a copy for offline use. */
async function networkFirst(request, cacheKey) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(cacheKey, response.clone());
    return response;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    return null;
  }
}

async function handleNavigation(request) {
  const response = await networkFirst(request, request.url);
  if (response) return response;
  // Last resort: the cached home shell. The app is local-first once loaded.
  const home = await caches.open(VERSION).then((c) => c.match("/"));
  if (home) return home;
  return new Response("Momentum needs a connection on first visit.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function handleRsc(request) {
  const cacheKey = new URL(request.url).href + RSC_QUERY;
  const response = await networkFirst(request, cacheKey);
  if (response) return response;
  // Offline navigation: the pre-warmed flight payload renders the route.
  const cached = await caches.open(VERSION).then((c) => c.match(cacheKey));
  if (cached) return cached;
  return new Response(null, { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || !sameOrigin(url)) return;

  // Client-side route transitions ask for RSC flight payloads.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(handleRsc(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Other same-origin GETs are left to the browser's HTTP cache.
});

/** Tapping a reminder brings the app forward (or opens it). */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => {
          try {
            return sameOrigin(new URL(client.url));
          } catch {
            return false;
          }
        });
        if (existing) return existing.focus();
        return self.clients.openWindow("/");
      }),
  );
});

/**
 * One-time background warm-up: fetch every route's document, queue the JS/CSS
 * chunks it references, resolve font files referenced from those stylesheets,
 * and finally fetch each route's RSC payload. All responses are written into
 * the versioned cache, so nothing here touches the network again.
 */
async function warmApp() {
  try {
    const cache = await caches.open(VERSION);
    const seen = new Set(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icon.svg"]);

    for (const path of ROUTES) {
      // 1. Document HTML (cached under its real URL for navigations).
      let html = "";
      try {
        const res = await fetch(path);
        if (res && res.ok) {
          await cache.put(path, res.clone());
          html = await res.text();
        }
      } catch {
        /* offline or transient failure — skip this route */
      }
      if (!html) continue;

      // 2. Hashed JS/CSS chunks referenced by the document.
      const assetPattern = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
      let match;
      const assetUrls = [];
      while ((match = assetPattern.exec(html))) assetUrls.push(match[1]);

      for (const url of assetUrls) {
        if (seen.has(url)) continue;
        seen.add(url);
        try {
          const res = await fetch(url);
          if (!res || !res.ok) continue;
          await cache.put(url, res.clone());
          // 3. Font files (woff2) pulled in from stylesheets (Next emits
          //    stylesheets under /_next/static/chunks/*.css).
          if (url.endsWith(".css")) {
            const text = await res.text();
            const fontPattern = /url\(([^)]+)\)/g;
            let fm;
            while ((fm = fontPattern.exec(text))) {
              const fontUrl = fm[1].replace(/["']/g, "").split("?")[0];
              if (!fontUrl.startsWith("/") || seen.has(fontUrl)) continue;
              seen.add(fontUrl);
              try {
                const fres = await fetch(fontUrl);
                if (fres && fres.ok) await cache.put(fontUrl, fres.clone());
              } catch {
                /* skip */
              }
            }
          }
        } catch {
          /* skip */
        }
      }

      // 4. RSC flight payload, stored separately from the document.
      try {
        const rsc = await fetch(path, {
          headers: { RSC: "1", "Next-Router-Prefetch": "1" },
        });
        if (rsc && rsc.ok) await cache.put(path + RSC_QUERY, rsc);
      } catch {
        /* skip */
      }
    }
  } catch (err) {
    console.warn("Momentum: offline warm-up incomplete", err);
  }
}
