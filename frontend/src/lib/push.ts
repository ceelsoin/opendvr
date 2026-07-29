/** Converts a base64url-encoded VAPID public key (as returned by the backend) into the Uint8Array `applicationServerKey` the Push API expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Whether this browser supports everything Web Push needs: service workers, the Push API, and the Notification API. */
export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The current subscription for this browser/device, if any (independent of whether the backend still knows about it). */
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Requests notification permission (if not already granted/denied) and
 * creates a new `PushSubscription` for this browser/device using the
 * server's VAPID public key. Throws if permission is denied or the
 * subscription attempt fails - the caller (SettingsPage) surfaces that as
 * a toast.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("permission-denied");
  }
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

/** Unsubscribes this browser/device from push at the browser level (the caller is still responsible for telling the backend to forget it). */
export async function unsubscribeFromPush(subscription: PushSubscription): Promise<void> {
  await subscription.unsubscribe();
}
