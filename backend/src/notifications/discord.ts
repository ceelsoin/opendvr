import { getNotificationSettings } from "./notificationSettings.js";

/**
 * Posts a message to a Discord channel via an incoming webhook. Either
 * attaches the snapshot (when the camera isn't recording, so it's the only
 * visual evidence) or appends a link to view the recording (when it is -
 * see events/cameraEvents.ts for which one gets passed), never both.
 */
export async function notifyDiscord(message: string, snapshot?: Buffer, recordingLink?: string): Promise<void> {
  const { discordWebhookUrl, discordAttachSnapshot } = getNotificationSettings();
  if (!discordWebhookUrl) return;

  const content = recordingLink ? `${message}\n🎬 ${recordingLink}` : message;
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
