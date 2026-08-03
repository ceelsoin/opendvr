import { hasPushSubscriptions, sendPushToAllSubscriptions } from "../lib/webPush.js";
import { getBackendLanguage } from "../i18n/index.js";
import { env } from "../config/env.js";
import { friendlyEventType } from "./eventLabels.js";
import type { NotificationChannel } from "./channel.js";

/**
 * Adapter exposing Web Push (lib/webPush.ts) through the common
 * NotificationChannel interface - see notifications/channel.ts + registry.ts.
 * Builds its own short title/body (a push notification needs punchier text
 * than the full chat message the other channels send), from the same
 * shared event - `isEnabled` ignores `settings` since push has no
 * user-entered config, just whether any browser is subscribed at all.
 */
export const webPushChannel: NotificationChannel = {
  id: "push",
  isEnabled: () => hasPushSubscriptions(),
  send: (event) =>
    sendPushToAllSubscriptions({
      title: `OpenDVR: ${friendlyEventType(event.topic)}`,
      body: `${event.camera.name} - ${new Date(event.occurredAt).toLocaleString(getBackendLanguage(), { timeZone: env.timezone })}`,
      url: event.recordingLink ?? (env.publicBaseUrl ? `${env.publicBaseUrl}/web/` : undefined),
      icon: event.snapshotUrl,
      tag: event.camera.id,
    }),
};
