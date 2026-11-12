/* Only the public offline page is cached. Never cache API, auth, plans or orders. */
const OFFLINE_CACHE = "ddakfit-offline-v1";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add("/pwa/offline.html")).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("ddakfit-offline-") && key !== OFFLINE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method === "GET" && event.request.mode === "navigate" && url.origin === self.location.origin && url.pathname === "/discover") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/pwa/offline.html")));
  }
});
function safeNoticeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== "/discover" || url.username || url.password) return "/discover";
    const id = url.searchParams.get("program");
    return id && id.length <= 250 ? `/discover?program=${encodeURIComponent(id)}` : "/discover";
  } catch { return "/discover"; }
}
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* Malformed payload still shows an informational notice. */ }
  if (!data || typeof data !== "object") data = {};
  event.waitUntil(self.registration.showNotification(
    typeof data.title === "string" ? data.title.slice(0, 80) : "딱, 지원핏 새 공고",
    { body: typeof data.body === "string" ? data.body.slice(0, 180) : "내 조건에 맞는 지원사업을 확인해 보세요.",
      icon: "/pwa/icon-192.png", badge: "/pwa/icon-192.png", tag: "ddakfit-program-digest",
      data: { url: safeNoticeUrl(data.url) } }
  ));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(safeNoticeUrl(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === "/discover" && "focus" in client) {
        await client.navigate(url); return client.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
