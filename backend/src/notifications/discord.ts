import { getNotificationSettings } from "./notificationSettings.js";
import type { NotificationChannel } from "./channel.js";

/**
 * Posts a message to a Discord channel via an incoming webhook. Attaches an
 * 8-second video clip of the actual event, straight from MediaMTX's
 * recording, when one was fetched (see media/eventClip.ts) - falling back
 * to the snapshot (either via ONVIF or the ffmpeg fallback, see
 * events/cameraEvents.ts) when no clip is available - and appends a link
 * to view the recording when the camera is actively recording - all can be
 * present at once except clip/snapshot, which are mutually exclusive.
 * Prefers a public `snapshotUrl` (uploaded to S3-compatible storage, see
 * lib/s3Storage.ts) over the raw multipart file upload when available and
 * there's no clip - some Discord webhook setups display an embed image
 * more reliably than a multipart attachment (this optimization doesn't
 * apply to video, which Discord embeds can't display - only real
 * attachments play inline).
 */
export async function notifyDiscord(
  message: string,
  snapshot?: Buffer,
  recordingLink?: string,
  snapshotUrl?: string,
  clip?: Buffer
): Promise<void> {
  const { discordWebhookUrl, discordAttachSnapshot } = getNotificationSettings();
  if (!discordWebhookUrl) return;

  const content = recordingLink ? `${message}\n🎬 ${recordingLink}` : message;

  if (clip && discordAttachSnapshot) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content }));
    form.append("file", new Blob([new Uint8Array(clip)], { type: "video/mp4" }), "clip.mp4");
    const res = await fetch(discordWebhookUrl, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`Discord webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }

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

/** Adapter exposing this channel through the common NotificationChannel interface - see notifications/channel.ts + registry.ts. */
export const discordChannel: NotificationChannel = {
  id: "discord",
  isEnabled: (settings) => Boolean(settings.discordWebhookUrl),
  send: (event) => notifyDiscord(event.message, event.snapshot, event.recordingLink, event.snapshotUrl, event.clip),
};
