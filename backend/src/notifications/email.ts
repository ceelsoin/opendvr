import nodemailer from "nodemailer";
import { getNotificationSettings } from "./notificationSettings.js";
import type { NotificationChannel } from "./channel.js";

/**
 * Sends a notification email via SMTP. Attaches the 8-second event clip
 * (see media/eventClip.ts) when one was fetched, falling back to the
 * snapshot when no clip is available, and includes a link to view the
 * recording in the body when the camera is actively recording.
 */
export async function notifyEmail(
  subject: string,
  text: string,
  snapshot?: Buffer,
  recordingLink?: string,
  clip?: Buffer
): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.emailSmtpHost || !settings.emailFrom || !settings.emailTo) return;

  const transporter = nodemailer.createTransport({
    host: settings.emailSmtpHost,
    port: settings.emailSmtpPort ?? 587,
    secure: settings.emailSmtpSecure,
    auth: settings.emailSmtpUser ? { user: settings.emailSmtpUser, pass: settings.emailSmtpPass ?? "" } : undefined,
  });

  const body = recordingLink ? `${text}\n\nAssistir gravação: ${recordingLink}` : text;

  let attachments: { filename: string; content: Buffer }[] | undefined;
  if (clip && settings.emailAttachSnapshot) {
    attachments = [{ filename: "clip.mp4", content: clip }];
  } else if (snapshot && settings.emailAttachSnapshot) {
    attachments = [{ filename: "snapshot.jpg", content: snapshot }];
  }

  await transporter.sendMail({
    from: settings.emailFrom,
    to: settings.emailTo,
    subject,
    text: body,
    attachments,
  });
}

/** Adapter exposing this channel through the common NotificationChannel interface - see notifications/channel.ts + registry.ts. */
export const emailChannel: NotificationChannel = {
  id: "email",
  isEnabled: (settings) => Boolean(settings.emailSmtpHost && settings.emailFrom && settings.emailTo),
  send: (event) => notifyEmail(event.subject, event.message, event.snapshot, event.recordingLink, event.clip),
};
