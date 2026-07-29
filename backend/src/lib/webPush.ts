import webpush from "web-push";
import { env } from "../config/env.js";
import { getSetting, setSetting } from "../db/settings.repository.js";
import { deletePushSubscription, listPushSubscriptions } from "../db/pushSubscriptions.repository.js";
import { logger } from "./logger.js";

/**
 * Web Push (browser/PWA push notifications - see frontend's `public/sw.js`
 * + `src/lib/push.ts`). Unlike the other notification channels
 * (Discord/Telegram/email/webhook, see notifications/*.ts), this one needs
 * no external service/credentials from the user - just a VAPID key pair,
 * which identifies THIS server to the browsers' push services (Google/
 * Mozilla/Apple's infrastructure, not something we talk to directly; the
 * `web-push` library handles that protocol entirely).
 */
const SETTINGS_KEYS = {
  publicKey: "push.vapidPublicKey",
  privateKey: "push.vapidPrivateKey",
} as const;

let cachedKeys: { publicKey: string; privateKey: string } | null = null;

/**
 * Resolves the VAPID key pair to use: env vars pin a specific pair (e.g. to
 * preserve identity across a DB restore to a fresh volume); otherwise a
 * pair is generated once and persisted in the `settings` table so it
 * survives restarts without requiring any manual setup step.
 */
function getVapidKeys(): { publicKey: string; privateKey: string } {
  if (cachedKeys) return cachedKeys;

  if (env.vapidPublicKey && env.vapidPrivateKey) {
    cachedKeys = { publicKey: env.vapidPublicKey, privateKey: env.vapidPrivateKey };
    return cachedKeys;
  }

  const storedPublicKey = getSetting(SETTINGS_KEYS.publicKey);
  const storedPrivateKey = getSetting(SETTINGS_KEYS.privateKey);
  if (storedPublicKey && storedPrivateKey) {
    cachedKeys = { publicKey: storedPublicKey, privateKey: storedPrivateKey };
    return cachedKeys;
  }

  const generated = webpush.generateVAPIDKeys();
  setSetting(SETTINGS_KEYS.publicKey, generated.publicKey);
  setSetting(SETTINGS_KEYS.privateKey, generated.privateKey);
  logger.info("Generated a new VAPID key pair for Web Push notifications (stored in the settings table)");
  cachedKeys = generated;
  return cachedKeys;
}

function ensureConfigured(): void {
  const keys = getVapidKeys();
  webpush.setVapidDetails(env.vapidSubject, keys.publicKey, keys.privateKey);
}

/** Public key the frontend needs to create a `PushSubscription` (see GET /api/push/vapid-public-key). */
export function getVapidPublicKey(): string {
  return getVapidKeys().publicKey;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Relative or absolute URL opened when the user clicks the notification (see sw.js's notificationclick handler). */
  url?: string;
  /** Notification icon - defaults to the app icon client-side if omitted. */
  icon?: string;
  /** Groups/replaces notifications from the same source (e.g. one per camera) instead of stacking. */
  tag?: string;
}

/**
 * Sends a push message to every subscribed browser/device. Never throws -
 * each subscription's failure is logged and doesn't affect the others.
 * Subscriptions the push service reports as gone (410) or not found (404) -
 * e.g. the user uninstalled the PWA, cleared site data, or revoked
 * notification permission - are removed so future sends don't keep
 * failing on them.
 */
export async function sendPushToAllSubscriptions(payload: PushPayload): Promise<void> {
  const subscriptions = listPushSubscriptions();
  if (subscriptions.length === 0) return;

  ensureConfigured();
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          body
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          deletePushSubscription(subscription.endpoint);
        } else {
          logger.warn({ err, endpoint: subscription.endpoint }, "Failed to send push notification");
        }
      }
    })
  );
}

/** Whether at least one browser/device has subscribed - used to short-circuit test sends and skip pointless work. */
export function hasPushSubscriptions(): boolean {
  return listPushSubscriptions().length > 0;
}
