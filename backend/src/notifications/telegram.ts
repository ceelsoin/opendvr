import { getNotificationSettings } from "./notificationSettings.js";

/**
 * Sends a message via the Telegram Bot API. Attaches an 8-second video clip
 * of the actual event, straight from MediaMTX's recording, when one was
 * fetched (see media/eventClip.ts) via `sendVideo` - falling back to the
 * snapshot as a photo+caption when no clip is available, appending a link
 * to view the recording in the caption/text when the camera is actively
 * recording. Prefers a public `snapshotUrl` (S3, see lib/s3Storage.ts) over
 * the raw multipart file upload for the snapshot fallback - Telegram's
 * `sendPhoto` accepts either a URL string or an uploaded file (this
 * optimization doesn't apply to the clip, which is never uploaded to S3).
 */
export async function notifyTelegram(
  message: string,
  snapshot?: Buffer,
  recordingLink?: string,
  snapshotUrl?: string,
  clip?: Buffer
): Promise<void> {
  const { telegramBotToken, telegramChatId, telegramAttachSnapshot } = getNotificationSettings();
  if (!telegramBotToken || !telegramChatId) return;

  const text = recordingLink ? `${message}\n🎬 ${recordingLink}` : message;
  const base = `https://api.telegram.org/bot${telegramBotToken}`;

  if (clip && telegramAttachSnapshot) {
    const form = new FormData();
    form.append("chat_id", telegramChatId);
    form.append("caption", text);
    form.append("video", new Blob([new Uint8Array(clip)], { type: "video/mp4" }), "clip.mp4");
    const res = await fetch(`${base}/sendVideo`, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`Telegram sendVideo failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }

  if (snapshotUrl && telegramAttachSnapshot) {
    const res = await fetch(`${base}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramChatId, caption: text, photo: snapshotUrl }),
    });
    if (!res.ok) {
      throw new Error(`Telegram sendPhoto failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }

  if (snapshot && telegramAttachSnapshot) {
    const form = new FormData();
    form.append("chat_id", telegramChatId);
    form.append("caption", text);
    form.append("photo", new Blob([new Uint8Array(snapshot)], { type: "image/jpeg" }), "snapshot.jpg");
    const res = await fetch(`${base}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`Telegram sendPhoto failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }

  const res = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramChatId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
