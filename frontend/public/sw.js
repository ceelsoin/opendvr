// OpenDVR service worker: enables Web Push notifications for the PWA (see
// docs/features.md's "Push notifications" section and
// frontend/src/lib/push.ts). Deliberately minimal - no asset caching/
// offline support here, that's a separate concern this app doesn't need
// (it's a LAN-only live-video app, offline browsing of a live camera feed
// makes no sense).

self.addEventListener("install", () => {
  // Activate this version immediately instead of waiting for all tabs
  // using the previous service worker to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Handles a push message sent by the backend (see
 * backend/src/lib/webPush.ts's sendPushToAllSubscriptions). Payload is a
 * JSON object: { title, body, url?, icon?, tag? } - see PushPayload there.
 */
self.addEventListener("push", (event) => {
  let payload = { title: "OpenDVR", body: "" };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    payload.body = event.data ? event.data.text() : "";
  }

  const iconUrl = payload.icon || `${self.registration.scope}icon-192.png`;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: iconUrl,
      badge: iconUrl,
      tag: payload.tag,
      data: { url: payload.url || self.registration.scope },
    })
  );
});

/** Focuses an already-open tab if there is one, otherwise opens a new one at the notification's URL. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : self.registration.scope;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
