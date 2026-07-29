import { getNotificationSettings } from "./notificationSettings.js";

export interface GenericWebhookPayload {
  cameraId: string;
  cameraName: string;
  topic: string;
  message: string;
  occurredAt: string;
  /** Set when the camera is recording (continuous/motion) - a link to view the clip in the Timeline instead of a snapshot. */
  recordingLink?: string;
  /** Public URL of the snapshot (uploaded to S3-compatible storage, see lib/s3Storage.ts), when configured - sent alongside/instead of the base64 blob below. */
  snapshotUrl?: string;
}

/**
 * POSTs a plain JSON payload to a user-configured URL, for integrating with
 * generic automation tools (n8n, Home Assistant, Zapier-style webhooks,
 * custom scripts, etc). The 8-second event clip (see media/eventClip.ts,
 * when fetched) or the snapshot (fallback, when no clip is available) is
 * embedded as base64 in the JSON body rather than sent as a multipart file
 * - most generic webhook consumers expect a single JSON payload, not
 * multipart parsing.
 */
export async function notifyGenericWebhook(payload: GenericWebhookPayload, snapshot?: Buffer, clip?: Buffer): Promise<void> {
  const { webhookUrl, webhookAttachSnapshot } = getNotificationSettings();
  if (!webhookUrl) return;

  const body: Record<string, unknown> = { ...payload };
  if (clip && webhookAttachSnapshot) {
    body.clipContentType = "video/mp4";
    body.clipBase64 = clip.toString("base64");
  } else if (snapshot && webhookAttachSnapshot) {
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
