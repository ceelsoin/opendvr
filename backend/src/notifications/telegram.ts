import { getNotificationSettings } from "./notificationSettings.js";

/**
 * Sends a message via the Telegram Bot API. Attaches the snapshot as a
 * photo+caption when one was captured, appending a link to view the
 * recording in the caption/text when the camera is actively recording -
 * both can be present at once. Prefers a public `snapshotUrl` (S3, see
 * lib/s3Storage.ts) over the raw multipart file upload when available -
 * Telegram's `sendPhoto` accepts either a URL string or an uploaded file.
 */
export async function notifyTelegram(
  message: string,
  snapshot?: Buffer,
  recordingLink?: string,
  snapshotUrl?: string
): Promise<void> {
  const { telegramBotToken, telegramChatId, telegramAttachSnapshot } = getNotificationSettings();
  if (!telegramBotToken || !telegramChatId) return;

  const text = recordingLink ? `${message}\n🎬 ${recordingLink}` : message;
  const base = `https://api.telegram.org/bot${telegramBotToken}`;

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
