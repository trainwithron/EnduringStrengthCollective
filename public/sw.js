// Push notifications, plus a small offline layer: the app's own files are kept after first use, and a workout page that was opened while online can be opened again with no signal.
// Nothing here ever answers a data request (the database and the API are never cached). The sets typed offline are kept by the app itself (lib/set-outbox.ts).
// A workout page is kept only for /sessions/ and is cleared when the person signs out.

const STATIC_CACHE = "esc-static-v1";
const PAGE_CACHE = "esc-pages-v1";
const MAX_PAGES = 12;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.add("/offline.html")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== STATIC_CACHE && n !== PAGE_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// The app asks to forget the kept workout pages when someone signs out on a shared phone.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "purge") event.waitUntil(caches.delete(PAGE_CACHE));
});

function isStaticAsset(url) {
  // Only the hashed, never-changing build files: a replaced icon or logo is always fetched fresh.
  return url.pathname.startsWith("/_next/static/");
}

async function trimPages(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (req.mode === "navigate") {
    const keep = url.pathname.startsWith("/sessions/");
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (keep && res.ok && res.type === "basic" && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((c) => c.put(req, copy).then(() => trimPages(c)));
          }
          return res;
        })
        .catch(async () => {
          const page = keep ? await caches.open(PAGE_CACHE).then((c) => c.match(req)) : null;
          return page || (await caches.open(STATIC_CACHE).then((c) => c.match("/offline.html"))) || Response.error();
        })
    );
  }
});

// Only ever open a path inside this app, never another address.
function samePath(url) {
  try {
    const parsed = new URL(url || "/", self.location.origin);
    if (parsed.origin !== self.location.origin) return "/";
    return parsed.pathname + parsed.search;
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = { title: "Spotlight Coaching", body: "You have a new notification." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload — fall back to the default text above.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/brand/spotlight-badge-72.png",
      data: { url: samePath(data.url) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = samePath(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
