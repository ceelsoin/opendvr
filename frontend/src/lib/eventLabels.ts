/** Human-friendly translation for common ONVIF event topic suffixes (mirrors backend/src/notifications/webhooks.ts). */
export function friendlyEventType(topic: string, t: (key: string) => string): string {
  const lower = topic.toLowerCase();
  if (lower.includes("tamper")) return t("eventTypes.tamperDetected");
  if (lower.includes("motion")) return t("eventTypes.motionDetected");
  if (lower.includes("linedetector")) return t("eventTypes.lineCrossingDetected");
  if (lower.includes("fielddetector") || lower.includes("intrusion")) return t("eventTypes.intrusionDetected");
  if (lower.includes("occupancy")) return t("eventTypes.occupancyDetected");
  return topic;
}
