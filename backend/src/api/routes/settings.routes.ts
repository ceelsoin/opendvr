import { Router } from "express";
import { z } from "zod";
import { getNotificationSettings, updateNotificationSettings } from "../../notifications/notificationSettings.js";
import { sendTestNotification } from "../../notifications/webhooks.js";
import { getBackendLanguage, setBackendLanguage, SUPPORTED_BACKEND_LANGUAGES, t } from "../../i18n/index.js";
import { errorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

export const settingsRouter = Router();

/**
 * Returns the actual saved values for most fields (so the Settings page can
 * show what's already configured, instead of a blank field the user has no
 * way to verify) - this endpoint is already gated behind global auth
 * (requireAuth), so there's no unauthenticated exposure risk. The one
 * exception is `emailSmtpPass` (an actual password, not just a scoped/
 * revocable webhook URL or bot token) - that one is never returned, same
 * convention as camera/login passwords; leaving it blank on save means
 * "keep the current one".
 */
function serializeSettings(settings: ReturnType<typeof getNotificationSettings>) {
  return {
    discordWebhookUrl: settings.discordWebhookUrl,
    discordWebhookConfigured: Boolean(settings.discordWebhookUrl),
    discordAttachSnapshot: settings.discordAttachSnapshot,
    telegramBotToken: settings.telegramBotToken,
    telegramChatId: settings.telegramChatId,
    telegramConfigured: Boolean(settings.telegramBotToken && settings.telegramChatId),
    telegramAttachSnapshot: settings.telegramAttachSnapshot,
    webhookUrl: settings.webhookUrl,
    webhookConfigured: Boolean(settings.webhookUrl),
    webhookAttachSnapshot: settings.webhookAttachSnapshot,
    emailConfigured: Boolean(settings.emailSmtpHost && settings.emailFrom && settings.emailTo),
    emailSmtpHost: settings.emailSmtpHost,
    emailSmtpPort: settings.emailSmtpPort,
    emailSmtpUser: settings.emailSmtpUser,
    emailSmtpSecure: settings.emailSmtpSecure,
    emailFrom: settings.emailFrom,
    emailTo: settings.emailTo,
    emailAttachSnapshot: settings.emailAttachSnapshot,
    s3Endpoint: settings.s3Endpoint,
    s3Region: settings.s3Region,
    s3AccessKey: settings.s3AccessKey,
    s3BucketName: settings.s3BucketName,
    s3Configured: Boolean(settings.s3Endpoint && settings.s3AccessKey && settings.s3SecretKey && settings.s3BucketName),
  };
}

settingsRouter.get("/notifications", (_req, res) => {
  res.json(serializeSettings(getNotificationSettings()));
});

/**
 * The single admin's UI language - kept in sync with the frontend's
 * language switcher (see frontend/src/i18n/index.ts) so backend-generated
 * text (API error messages, Discord/Telegram/email notifications) matches
 * whatever language the UI is actually shown in. See backend/src/i18n/.
 */
settingsRouter.get("/language", (_req, res) => {
  res.json({ language: getBackendLanguage() });
});

const languageSchema = z.object({ language: z.enum(SUPPORTED_BACKEND_LANGUAGES as [string, ...string[]]) });

settingsRouter.put("/language", (req, res) => {
  const parsed = languageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  setBackendLanguage(parsed.data.language);
  res.json({ language: getBackendLanguage() });
});

const updateNotificationSettingsSchema = z.object({
  discordWebhookUrl: z.string().nullable().optional(),
  discordAttachSnapshot: z.boolean().optional(),
  telegramBotToken: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
  telegramAttachSnapshot: z.boolean().optional(),
  webhookUrl: z.string().nullable().optional(),
  webhookAttachSnapshot: z.boolean().optional(),
  emailSmtpHost: z.string().nullable().optional(),
  emailSmtpPort: z.number().int().positive().nullable().optional(),
  emailSmtpUser: z.string().nullable().optional(),
  emailSmtpPass: z.string().nullable().optional(),
  emailSmtpSecure: z.boolean().optional(),
  emailFrom: z.string().nullable().optional(),
  emailTo: z.string().nullable().optional(),
  emailAttachSnapshot: z.boolean().optional(),
  s3Endpoint: z.string().nullable().optional(),
  s3Region: z.string().nullable().optional(),
  s3AccessKey: z.string().nullable().optional(),
  s3SecretKey: z.string().nullable().optional(),
  s3BucketName: z.string().nullable().optional(),
});

settingsRouter.put("/notifications", (req, res) => {
  const parsed = updateNotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  const updated = updateNotificationSettings(parsed.data);
  res.json(serializeSettings(updated));
});

const testNotificationSchema = z.object({
  channel: z.enum(["discord", "telegram", "webhook", "email"]),
});

settingsRouter.post("/notifications/test", async (req, res) => {
  const parsed = testNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  try {
    await sendTestNotification(parsed.data.channel);
    res.json({ ok: true });
  } catch (err) {
    logger.warn({ err, channel: parsed.data.channel }, "Test notification failed");
    res.status(502).json({ ok: false, error: errorMessage(err) });
  }
});
