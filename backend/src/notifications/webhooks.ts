import type { Camera } from "../types/camera.js";
import { env } from "../config/env.js";
import { getNotificationSettings } from "./notificationSettings.js";
import { notifyDiscord } from "./discord.js";
import { notifyTelegram } from "./telegram.js";
import { notifyGenericWebhook } from "./genericWebhook.js";
import { notifyEmail } from "./email.js";
import { logger } from "../lib/logger.js";

/** Human-friendly translation for common ONVIF event topic suffixes. */
function friendlyEventType(topic: string): string {
  const lower = topic.toLowerCase();
  if (lower.includes("tamper")) return "Violação/adulteração detectada";
  if (lower.includes("motion")) return "Movimento detectado";
  if (lower.includes("linedetector")) return "Cruzamento de linha detectado";
  if (lower.includes("fielddetector") || lower.includes("intrusion")) return "Intrusão em área detectada";
  if (lower.includes("occupancy")) return "Ocupação de área detectada";
  return topic;
}

function buildMessage(camera: Pick<Camera, "name">, topic: string, occurredAt: Date): string {
  const time = occurredAt.toLocaleString("pt-BR", { timeZone: env.timezone });
  return `📷 ${camera.name}: ${friendlyEventType(topic)} às ${time}`;
}

/**
 * Sends best-effort external notifications (Discord, Telegram, a generic
 * JSON webhook and email, each independently optional/configurable from
 * the Settings page or env vars, each with its own "attach snapshot"
 * toggle) for a camera event. Never throws - each channel's failure is
 * logged and doesn't affect the others or the caller (the ONVIF event
 * stream / video motion detector).
 */
export async function notifyEvent(
  camera: Pick<Camera, "id" | "name">,
  topic: string,
  snapshot?: Buffer,
  recordingLink?: string,
  snapshotUrl?: string
): Promise<void> {
  const message = buildMessage(camera, topic, new Date());
  const occurredAt = new Date().toISOString();

  const results = await Promise.allSettled([
    notifyDiscord(message, snapshot, recordingLink, snapshotUrl),
    notifyTelegram(message, snapshot, recordingLink, snapshotUrl),
    notifyGenericWebhook(
      { cameraId: camera.id, cameraName: camera.name, topic, message, occurredAt, recordingLink, snapshotUrl },
      snapshot
    ),
    notifyEmail(`OpenDVR: ${friendlyEventType(topic)} (${camera.name})`, message, snapshot, recordingLink),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn({ err: result.reason, cameraId: camera.id }, "Failed to send event notification");
    }
  }
}

export type NotificationChannel = "discord" | "telegram" | "webhook" | "email";

/** Sends a one-off test message on the given channel, for the Settings page's "Testar" button. Throws on failure (caller reports it to the user). */
export async function sendTestNotification(channel: NotificationChannel): Promise<void> {
  const message = "🔔 Notificação de teste do OpenDVR";
  const settings = getNotificationSettings();

  switch (channel) {
    case "discord":
      if (!settings.discordWebhookUrl) {
        throw new Error("Webhook do Discord não configurado.");
      }
      await notifyDiscord(message);
      return;
    case "telegram":
      if (!settings.telegramBotToken || !settings.telegramChatId) {
        throw new Error("Bot token / chat ID do Telegram não configurados.");
      }
      await notifyTelegram(message);
      return;
    case "webhook":
      if (!settings.webhookUrl) {
        throw new Error("URL do webhook genérico não configurada.");
      }
      await notifyGenericWebhook({
        cameraId: "test",
        cameraName: "Teste",
        topic: "test",
        message,
        occurredAt: new Date().toISOString(),
      });
      return;
    case "email":
      if (!settings.emailSmtpHost || !settings.emailFrom || !settings.emailTo) {
        throw new Error("SMTP não configurado (host, remetente e destinatário são obrigatórios).");
      }
      await notifyEmail("OpenDVR: notificação de teste", message);
      return;
  }
}

