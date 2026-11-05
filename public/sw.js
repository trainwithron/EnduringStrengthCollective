// Push notifications, plus a small offline layer: the app's own files are kept after first use, and a workout page that was opened while online can be opened again with no signal.
// Nothing here ever answers a data request (the database and the API are never cached). The sets typed offline are kept by the app itself (lib/set-outbox.ts).
// A workout page is kept only for /sessions/ and is cleared when the person signs out.

const STATIC_CACHE = "esc-static-v2";
const PAGE_CACHE = "esc-pages-v1";
const MAX_PAGES = 12;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.add("/offline.html")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // A page is asked for while the worker starts up, instead of after (navigation preload): opening the app does not wait for the worker first.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      // Every older cache goes (esc-static-v1 included).
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== STATIC_CACHE && n !== PAGE_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
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
      (async () => {
        // The page the browser already started fetching while the worker woke up (navigation preload), else a normal fetch.
        const pre = await event.preloadResponse;
        return pre || (await fetch(req));
      })()
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

// Only ever open a path inside this app, never another address. The part after # is kept: it is what opens the panel a notice is about (#late-changes opens the requests to confirm;
// without it a booking request's notice only opened Home, Ron, Nov 5).
function samePath(url) {
  try {
    const parsed = new URL(url || "/", self.location.origin);
    if (parsed.origin !== self.location.origin) return "/";
    return parsed.pathname + parsed.search + parsed.hash;
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

  // A booking request can be answered from the notification itself (Ron, Nov 5): Confirm and Decline buttons where the phone shows them (Android); tapping the notification still opens the requests.
  const requestId = typeof data.requestId === "string" ? data.requestId : null;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/brand/spotlight-badge-72.png",
      data: { url: samePath(data.url), requestId },
      ...(requestId ? { actions: [{ action: "confirm", title: "Confirm" }, { action: "decline", title: "Decline" }] } : {}),
    })
  );
});

function openApp(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url.includes(self.location.origin) && "focus" in client) {
        client.navigate(url);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  });
}

// Confirm or Decline pressed on the notification: saved with the coach's own sign-in, then a short notice says what happened. Signed out, or anything that did not save: the requests open instead.
async function answerRequest(requestId, confirm, url) {
  try {
    const res = await fetch("/api/bookings/request-answer", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, confirm }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && typeof out.line === "string") {
      await self.registration.showNotification(out.line, { icon: "/icon-192.png", badge: "/brand/spotlight-badge-72.png", tag: "answer-" + requestId, data: { url } });
      return;
    }
  } catch {
    // no signal: open the app below
  }
  return openApp(url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = samePath(data.url);
  if ((event.action === "confirm" || event.action === "decline") && data.requestId) {
    event.waitUntil(answerRequest(data.requestId, event.action === "confirm", url));
    return;
  }
  event.waitUntil(openApp(url));
});
