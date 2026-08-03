import { t } from "../i18n/index.js";

/** Human-friendly translation for common ONVIF event topic suffixes, in the admin's configured language (see backend/src/i18n/) - shared by webhooks.ts (chat message text) and webPushChannel.ts (notification title). */
export function friendlyEventType(topic: string): string {
  const lower = topic.toLowerCase();
  if (lower === "object:person") return t("notifications.personDetected");
  if (lower === "object:vehicle") return t("notifications.vehicleDetected");
  if (lower === "object:animal") return t("notifications.animalDetected");
  if (lower === "object:other") return t("notifications.objectDetected");
  if (lower.includes("tamper")) return t("notifications.tamperDetected");
  if (lower.includes("motion")) return t("notifications.motionDetected");
  if (lower.includes("linedetector")) return t("notifications.lineCrossingDetected");
  if (lower.includes("fielddetector") || lower.includes("intrusion")) return t("notifications.intrusionDetected");
  if (lower.includes("occupancy")) return t("notifications.occupancyDetected");
  return topic;
}
