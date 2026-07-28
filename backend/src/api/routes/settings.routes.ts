import { Router } from "express";
import { z } from "zod";
import { getNotificationSettings, updateNotificationSettings } from "../../notifications/notificationSettings.js";
import { sendTestNotification } from "../../notifications/webhooks.js";
import { errorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

export const settingsRouter = Router();

/**
 * Never returns the raw secret values back to the client (same convention
 * as camera passwords) - just whether each channel is currently configured,
 * plus its attach-snapshot preference. Saving a new value always requires
 * typing it in again (a blank field on save means "leave unchanged", not
 * "clear" - see updateNotificationSettingsSchema).
 */
function serializeSettings(settings: ReturnType<typeof getNotificationSettings>) {
  return {
    discordWebhookConfigured: Boolean(settings.discordWebhookUrl),
    discordAttachSnapshot: settings.discordAttachSnapshot,
    telegramConfigured: Boolean(settings.telegramBotToken && settings.telegramChatId),
    telegramAttachSnapshot: settings.telegramAttachSnapshot,
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
  };
}

settingsRouter.get("/notifications", (_req, res) => {
  res.json(serializeSettings(getNotificationSettings()));
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
});

settingsRouter.put("/notifications", (req, res) => {
  const parsed = updateNotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
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
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
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
