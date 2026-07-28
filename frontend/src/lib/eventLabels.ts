/** Human-friendly translation for common ONVIF event topic suffixes (mirrors backend/src/notifications/webhooks.ts). */
export function friendlyEventType(topic: string): string {
  const lower = topic.toLowerCase();
  if (lower.includes("tamper")) return "Violação/adulteração detectada";
  if (lower.includes("motion")) return "Movimento detectado";
  if (lower.includes("linedetector")) return "Cruzamento de linha detectado";
  if (lower.includes("fielddetector") || lower.includes("intrusion")) return "Intrusão em área detectada";
  if (lower.includes("occupancy")) return "Ocupação de área detectada";
  return topic;
}
