import { getNotificationSettings } from "./notificationSettings.js";

/**
 * Sends a message via the Telegram Bot API. Either attaches the snapshot as
 * a photo+caption (when the camera isn't recording) or sends a plain text
 * message with a link to view the recording (when it is).
 */
export async function notifyTelegram(message: string, snapshot?: Buffer, recordingLink?: string): Promise<void> {
  const { telegramBotToken, telegramChatId, telegramAttachSnapshot } = getNotificationSettings();
  if (!telegramBotToken || !telegramChatId) return;

  const text = recordingLink ? `${message}\n🎬 ${recordingLink}` : message;
  const base = `https://api.telegram.org/bot${telegramBotToken}`;
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
