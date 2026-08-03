import type { Camera } from "../types/camera.js";
import { env } from "../config/env.js";
import { getNotificationSettings } from "./notificationSettings.js";
import { friendlyEventType } from "./eventLabels.js";
import { channels } from "./registry.js";
import type { NotificationEvent, NotificationChannelId } from "./channel.js";
import { eventBus } from "../events/bus.js";
import { t, getBackendLanguage } from "../i18n/index.js";
import { logger } from "../lib/logger.js";

function buildMessage(camera: Pick<Camera, "name">, topic: string, occurredAt: Date, caption?: string): string {
  const time = occurredAt.toLocaleString(getBackendLanguage(), { timeZone: env.timezone });
  const base = t("notifications.eventMessage", { camera: camera.name, eventType: friendlyEventType(topic), time });
  return caption ? `${base}\n📝 ${caption}` : base;
}

/**
 * Sends `event` to every channel in notifications/registry.ts that's both
 * allowed for this notification's kind (see CONNECTIVITY_CHANNEL_IDS below)
 * and currently configured (`isEnabled`). Never throws - each channel's
 * failure is logged and doesn't affect the others or the caller.
 */
async function dispatchToChannels(event: NotificationEvent, allowedIds?: ReadonlySet<NotificationChannelId>): Promise<void> {
  const settings = getNotificationSettings();
  const applicable = channels.filter((channel) => (!allowedIds || allowedIds.has(channel.id)) && channel.isEnabled(settings));
  const results = await Promise.allSettled(applicable.map((channel) => channel.send(event)));
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn({ err: result.reason, cameraId: event.camera.id }, `Failed to send ${event.kind} notification`);
    }
  }
}

/**
 * Sends best-effort external notifications (every channel in
 * notifications/registry.ts) for a camera event. Never throws - each
 * channel's failure is logged and doesn't affect the others or the caller
 * (the ONVIF event stream / video motion detector). Also emitted on the
 * internal event bus (events/bus.ts), so a future plugin can subscribe
 * independently of the channel registry - see plans/04-event-bus-plugins.md.
 */
export async function notifyEvent(
  camera: Pick<Camera, "id" | "name">,
  topic: string,
  snapshot?: Buffer,
  recordingLink?: string,
  snapshotUrl?: string,
  clip?: Buffer,
  caption?: string
): Promise<void> {
  const occurredAt = new Date();
  const event: NotificationEvent = {
    kind: "camera_event",
    camera,
    topic,
    message: buildMessage(camera, topic, occurredAt, caption),
    subject: `OpenDVR: ${friendlyEventType(topic)} (${camera.name})`,
    occurredAt: occurredAt.toISOString(),
    snapshot,
    recordingLink,
    snapshotUrl,
    clip,
    caption,
  };
  eventBus.emitTyped("camera:event", event);
  await dispatchToChannels(event);
}

// Web Push has no "connectivity blip" payload today and was never wired to
// these two notifications - preserved as-is rather than silently adding it.
const CONNECTIVITY_CHANNEL_IDS = new Set<NotificationChannelId>(["discord", "telegram", "webhook", "email"]);

/** Renders a duration as a short, language-agnostic "Xh Ymin" / "Ymin" string - used in connectivity notifications below. */
function formatDurationHuman(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

/**
 * Sends a "camera unavailable" alert to every configured channel (Discord,
 * Telegram, generic webhook, email) - called once a camera has been
 * continuously unreachable for a while (see index.ts's reconciliation
 * loop), and again on a recurring cadence for as long as it stays down, so
 * an outage isn't a single easy-to-miss ping.
 */
export async function notifyCameraUnavailable(camera: Pick<Camera, "id" | "name">, downSinceMs: number): Promise<void> {
  const since = new Date(downSinceMs).toLocaleString(getBackendLanguage(), { timeZone: env.timezone });
  const duration = formatDurationHuman(Date.now() - downSinceMs);
  const message = t("notifications.cameraUnavailable", { camera: camera.name, duration, since });
  const event: NotificationEvent = {
    kind: "camera_unavailable",
    camera,
    topic: "camera.unavailable",
    message,
    subject: `OpenDVR: ${camera.name} ${t("notifications.cameraUnavailableSubject")}`,
    occurredAt: new Date().toISOString(),
  };
  eventBus.emitTyped("camera:unavailable", event);
  await dispatchToChannels(event, CONNECTIVITY_CHANNEL_IDS);
}

/** Sends a "camera back online" notice to every configured channel - only called for outages that were actually long enough to have triggered `notifyCameraUnavailable` above, so brief blips don't also spam a recovery message. */
export async function notifyCameraRecovered(camera: Pick<Camera, "id" | "name">, downForMs: number): Promise<void> {
  const duration = formatDurationHuman(downForMs);
  const message = t("notifications.cameraRecovered", { camera: camera.name, duration });
  const event: NotificationEvent = {
    kind: "camera_recovered",
    camera,
    topic: "camera.recovered",
    message,
    subject: `OpenDVR: ${camera.name} ${t("notifications.cameraRecoveredSubject")}`,
    occurredAt: new Date().toISOString(),
  };
  eventBus.emitTyped("camera:recovered", event);
  await dispatchToChannels(event, CONNECTIVITY_CHANNEL_IDS);
}

const NOT_CONFIGURED_ERROR_KEYS: Record<NotificationChannelId, string> = {
  discord: "errors.discordNotConfigured",
  telegram: "errors.telegramNotConfigured",
  webhook: "errors.webhookNotConfigured",
  email: "errors.smtpNotConfigured",
  push: "errors.pushNotConfigured",
};

/** Sends a one-off test message on the given channel, for the Settings page's "Testar" button. Throws on failure (caller reports it to the user). */
export async function sendTestNotification(channelId: NotificationChannelId): Promise<void> {
  const settings = getNotificationSettings();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel || !channel.isEnabled(settings)) {
    throw new Error(t(NOT_CONFIGURED_ERROR_KEYS[channelId]));
  }
  const message = t("notifications.testMessage");
  await channel.send({
    kind: "test",
    camera: { id: "test", name: t("notifications.testCameraName") },
    topic: "test",
    message,
    subject: `OpenDVR: ${message}`,
    occurredAt: new Date().toISOString(),
  });
}

