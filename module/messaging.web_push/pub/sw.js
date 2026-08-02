// Push fragment of the app service worker — see module/serviceworker.

self.addEventListener("push", (e) => {
  // everything but title and url goes to showNotification unchanged
  const { title = "", url, ...options } = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(title, { ...options, data: { url } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url;
  if (!url) return;
  e.waitUntil((async () => {
    const target = new URL(url, self.location.origin).href;
    // reuse the tab that already shows the target instead of opening a second one
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (client.url === target) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
