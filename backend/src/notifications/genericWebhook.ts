import { getNotificationSettings } from "./notificationSettings.js";

export interface GenericWebhookPayload {
  cameraId: string;
  cameraName: string;
  topic: string;
  message: string;
  occurredAt: string;
  /** Set when the camera is recording (continuous/motion) - a link to view the clip in the Timeline instead of a snapshot. */
  recordingLink?: string;
}

/**
 * POSTs a plain JSON payload to a user-configured URL, for integrating with
 * generic automation tools (n8n, Home Assistant, Zapier-style webhooks,
 * custom scripts, etc). The snapshot (when attached) is embedded as base64
 * in the JSON body rather than sent as a multipart file - most generic
 * webhook consumers expect a single JSON payload, not multipart parsing.
 */
export async function notifyGenericWebhook(payload: GenericWebhookPayload, snapshot?: Buffer): Promise<void> {
  const { webhookUrl, webhookAttachSnapshot } = getNotificationSettings();
  if (!webhookUrl) return;

  const body: Record<string, unknown> = { ...payload };
  if (snapshot && webhookAttachSnapshot) {
    body.snapshotContentType = "image/jpeg";
    body.snapshotBase64 = snapshot.toString("base64");
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Generic webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
