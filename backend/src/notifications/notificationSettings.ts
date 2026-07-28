import { getSetting, setSetting } from "../db/settings.repository.js";
import { env } from "../config/env.js";

/**
 * Notification channel config, editable at runtime from the UI (Settings
 * page) and persisted in the `settings` table - takes precedence over the
 * equivalent env var, which remains as the deploy-time default/fallback
 * (e.g. for headless/first-boot setups with no UI access yet). Each channel
 * also has its own "attach snapshot" toggle, independent of the others.
 */
const KEYS = {
  discordWebhookUrl: "notifications.discordWebhookUrl",
  discordAttachSnapshot: "notifications.discordAttachSnapshot",
  telegramBotToken: "notifications.telegramBotToken",
  telegramChatId: "notifications.telegramChatId",
  telegramAttachSnapshot: "notifications.telegramAttachSnapshot",
  webhookUrl: "notifications.webhookUrl",
  webhookAttachSnapshot: "notifications.webhookAttachSnapshot",
  emailSmtpHost: "notifications.emailSmtpHost",
  emailSmtpPort: "notifications.emailSmtpPort",
  emailSmtpUser: "notifications.emailSmtpUser",
  emailSmtpPass: "notifications.emailSmtpPass",
  emailSmtpSecure: "notifications.emailSmtpSecure",
  emailFrom: "notifications.emailFrom",
  emailTo: "notifications.emailTo",
  emailAttachSnapshot: "notifications.emailAttachSnapshot",
  publicBaseUrl: "notifications.publicBaseUrl",
} as const;

function getBool(key: string, fallback: boolean): boolean {
  const value = getSetting(key);
  if (value === null) return fallback;
  return value === "1";
}

function getNumber(key: string, fallback: number | null): number | null {
  const value = getSetting(key);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface NotificationSettings {
  discordWebhookUrl: string | null;
  discordAttachSnapshot: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  telegramAttachSnapshot: boolean;
  webhookUrl: string | null;
  webhookAttachSnapshot: boolean;
  emailSmtpHost: string | null;
  emailSmtpPort: number | null;
  emailSmtpUser: string | null;
  emailSmtpPass: string | null;
  emailSmtpSecure: boolean;
  emailFrom: string | null;
  emailTo: string | null;
  emailAttachSnapshot: boolean;
  publicBaseUrl: string | null;
}

export function getNotificationSettings(): NotificationSettings {
  return {
    discordWebhookUrl: getSetting(KEYS.discordWebhookUrl) ?? env.discordWebhookUrl,
    discordAttachSnapshot: getBool(KEYS.discordAttachSnapshot, true),
    telegramBotToken: getSetting(KEYS.telegramBotToken) ?? env.telegramBotToken,
    telegramChatId: getSetting(KEYS.telegramChatId) ?? env.telegramChatId,
    telegramAttachSnapshot: getBool(KEYS.telegramAttachSnapshot, true),
    webhookUrl: getSetting(KEYS.webhookUrl) ?? env.genericWebhookUrl,
    webhookAttachSnapshot: getBool(KEYS.webhookAttachSnapshot, true),
    emailSmtpHost: getSetting(KEYS.emailSmtpHost) ?? env.smtpHost,
    emailSmtpPort: getNumber(KEYS.emailSmtpPort, env.smtpPort),
    emailSmtpUser: getSetting(KEYS.emailSmtpUser) ?? env.smtpUser,
    emailSmtpPass: getSetting(KEYS.emailSmtpPass) ?? env.smtpPass,
    emailSmtpSecure: getBool(KEYS.emailSmtpSecure, env.smtpSecure),
    emailFrom: getSetting(KEYS.emailFrom) ?? env.emailFrom,
    emailTo: getSetting(KEYS.emailTo) ?? env.emailTo,
    emailAttachSnapshot: getBool(KEYS.emailAttachSnapshot, true),
    publicBaseUrl: getSetting(KEYS.publicBaseUrl) ?? env.publicBaseUrl,
  };
}

export interface UpdateNotificationSettingsInput {
  /** `undefined` = leave unchanged, `null`/empty = clear (fall back to env var again), value = set. */
  discordWebhookUrl?: string | null;
  discordAttachSnapshot?: boolean;
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  telegramAttachSnapshot?: boolean;
  webhookUrl?: string | null;
  webhookAttachSnapshot?: boolean;
  emailSmtpHost?: string | null;
  emailSmtpPort?: number | null;
  emailSmtpUser?: string | null;
  emailSmtpPass?: string | null;
  emailSmtpSecure?: boolean;
  emailFrom?: string | null;
  emailTo?: string | null;
  emailAttachSnapshot?: boolean;
  publicBaseUrl?: string | null;
}

function setStringSetting(key: string, value: string | null | undefined): void {
  if (value === undefined) return;
  setSetting(key, value || null);
}

function setBoolSetting(key: string, value: boolean | undefined): void {
  if (value === undefined) return;
  setSetting(key, value ? "1" : "0");
}

export function updateNotificationSettings(input: UpdateNotificationSettingsInput): NotificationSettings {
  setStringSetting(KEYS.discordWebhookUrl, input.discordWebhookUrl);
  setBoolSetting(KEYS.discordAttachSnapshot, input.discordAttachSnapshot);
  setStringSetting(KEYS.telegramBotToken, input.telegramBotToken);
  setStringSetting(KEYS.telegramChatId, input.telegramChatId);
  setBoolSetting(KEYS.telegramAttachSnapshot, input.telegramAttachSnapshot);
  setStringSetting(KEYS.webhookUrl, input.webhookUrl);
  setBoolSetting(KEYS.webhookAttachSnapshot, input.webhookAttachSnapshot);
  setStringSetting(KEYS.emailSmtpHost, input.emailSmtpHost);
  if (input.emailSmtpPort !== undefined) {
    setSetting(KEYS.emailSmtpPort, input.emailSmtpPort === null ? null : String(input.emailSmtpPort));
  }
  setStringSetting(KEYS.emailSmtpUser, input.emailSmtpUser);
  setStringSetting(KEYS.emailSmtpPass, input.emailSmtpPass);
  setBoolSetting(KEYS.emailSmtpSecure, input.emailSmtpSecure);
  setStringSetting(KEYS.emailFrom, input.emailFrom);
  setStringSetting(KEYS.emailTo, input.emailTo);
  setBoolSetting(KEYS.emailAttachSnapshot, input.emailAttachSnapshot);
  setStringSetting(KEYS.publicBaseUrl, input.publicBaseUrl);
  return getNotificationSettings();
}

