// Minimal push service worker — shows a real OS notification for
// whatever payload the send API pushes, and focuses/opens the app on
// click. No caching/offline behavior here; this exists purely to
// receive push events.
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
