import { getNotificationSettings } from "./notificationSettings.js";

/**
 * Posts a message to a Discord channel via an incoming webhook. Attaches
 * the snapshot when one was captured (either via ONVIF or the ffmpeg
 * fallback, see events/cameraEvents.ts) and appends a link to view the
 * recording when the camera is actively recording - both can be present at
 * once. Prefers a public `snapshotUrl` (uploaded to S3-compatible storage,
 * see lib/s3Storage.ts) over the raw multipart file upload when available -
 * some Discord webhook setups display an embed image more reliably than a
 * multipart attachment.
 */
export async function notifyDiscord(
  message: string,
  snapshot?: Buffer,
  recordingLink?: string,
  snapshotUrl?: string
): Promise<void> {
  const { discordWebhookUrl, discordAttachSnapshot } = getNotificationSettings();
  if (!discordWebhookUrl) return;

  const content = recordingLink ? `${message}\n🎬 ${recordingLink}` : message;

  if (snapshotUrl && discordAttachSnapshot) {
    const res = await fetch(discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds: [{ image: { url: snapshotUrl } }] }),
    });
    if (!res.ok) {
      throw new Error(`Discord webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  if (snapshot && discordAttachSnapshot) {
    form.append("file", new Blob([new Uint8Array(snapshot)], { type: "image/jpeg" }), "snapshot.jpg");
  }

  const res = await fetch(discordWebhookUrl, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
