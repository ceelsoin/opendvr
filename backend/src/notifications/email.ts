import nodemailer from "nodemailer";
import { getNotificationSettings } from "./notificationSettings.js";

/**
 * Sends a notification email via SMTP. Attaches the snapshot when one was
 * captured and includes a link to view the recording in the body when the
 * camera is actively recording - both can be present at once.
 */
export async function notifyEmail(subject: string, text: string, snapshot?: Buffer, recordingLink?: string): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.emailSmtpHost || !settings.emailFrom || !settings.emailTo) return;

  const transporter = nodemailer.createTransport({
    host: settings.emailSmtpHost,
    port: settings.emailSmtpPort ?? 587,
    secure: settings.emailSmtpSecure,
    auth: settings.emailSmtpUser ? { user: settings.emailSmtpUser, pass: settings.emailSmtpPass ?? "" } : undefined,
  });

  const body = recordingLink ? `${text}\n\nAssistir gravação: ${recordingLink}` : text;

  await transporter.sendMail({
    from: settings.emailFrom,
    to: settings.emailTo,
    subject,
    text: body,
    attachments:
      snapshot && settings.emailAttachSnapshot ? [{ filename: "snapshot.jpg", content: snapshot }] : undefined,
  });
}
