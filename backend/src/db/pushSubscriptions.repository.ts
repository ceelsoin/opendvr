import { db } from "./client.js";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Insert or, if this browser/device already subscribed before (same endpoint), refresh its keys. */
export function upsertPushSubscription(input: PushSubscriptionRow): void {
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (@endpoint, @p256dh, @auth)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = @p256dh, auth = @auth`
  ).run(input);
}

export function deletePushSubscription(endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function listPushSubscriptions(): PushSubscriptionRow[] {
  return db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all() as PushSubscriptionRow[];
}
