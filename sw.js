const OTS_CACHE = "ots-booking-v40-dev-stable";
const OTS_ASSETS = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./manifest-admin.json",
  "./ots-main.css",
  "./ots-app-core.js",
  "./ots-boot.js",
  "./ots-mobile-scroll.js",
  "./ots-brand-mark.png",
  "./ots-login-logo.png",
  "./gcc-logo.png",
  "./chennai-smart-city.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(OTS_CACHE)
      .then(cache => cache.addAll(OTS_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== OTS_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type !== "SHOW_NOTIF") return;
  const payload = data.payload || {};
  const title = payload.title || "OTS Booking";
  const options = {
    body: payload.body || "",
    tag: payload.tag || "ots-booking",
    icon: "./ots-brand-mark.png",
    badge: "./ots-brand-mark.png",
    data: payload.data || { url: "./index.html" },
    requireInteraction: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = new URL(data.url || "./index.html", self.location.href).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(OTS_CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        return caches.match(url.pathname.endsWith("/admin.html") ? "./admin.html" : "./index.html");
      }))
  );
});
