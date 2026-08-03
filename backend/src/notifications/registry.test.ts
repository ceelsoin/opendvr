import { describe, it, expect, beforeAll } from "vitest";
import { runMigrations } from "../db/client.js";
import { channels } from "./registry.js";
import type { NotificationSettings } from "./notificationSettings.js";

function baseSettings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    discordWebhookUrl: null,
    discordAttachSnapshot: true,
    telegramBotToken: null,
    telegramChatId: null,
    telegramAttachSnapshot: true,
    webhookUrl: null,
    webhookAttachSnapshot: true,
    emailSmtpHost: null,
    emailSmtpPort: null,
    emailSmtpUser: null,
    emailSmtpPass: null,
    emailSmtpSecure: false,
    emailFrom: null,
    emailTo: null,
    emailAttachSnapshot: true,
    publicBaseUrl: null,
    s3Endpoint: null,
    s3Region: null,
    s3AccessKey: null,
    s3SecretKey: null,
    s3BucketName: null,
    ...overrides,
  };
}

function findChannel(id: string) {
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new Error(`Channel ${id} not registered`);
  return channel;
}

describe("notification channel registry", () => {
  beforeAll(() => {
    runMigrations();
  });

  it("registers exactly the 5 built-in channels with unique ids", () => {
    const ids = channels.map((c) => c.id);
    expect(ids).toEqual(["discord", "telegram", "webhook", "email", "push"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("discord channel is enabled only when a webhook URL is configured", () => {
    const discord = findChannel("discord");
    expect(discord.isEnabled(baseSettings())).toBe(false);
    expect(discord.isEnabled(baseSettings({ discordWebhookUrl: "https://discord.example/hook" }))).toBe(true);
  });

  it("telegram channel requires both a bot token and a chat id", () => {
    const telegram = findChannel("telegram");
    expect(telegram.isEnabled(baseSettings({ telegramBotToken: "token-only" }))).toBe(false);
    expect(telegram.isEnabled(baseSettings({ telegramChatId: "chat-only" }))).toBe(false);
    expect(telegram.isEnabled(baseSettings({ telegramBotToken: "token", telegramChatId: "chat" }))).toBe(true);
  });

  it("generic webhook channel is enabled only when a URL is configured", () => {
    const webhook = findChannel("webhook");
    expect(webhook.isEnabled(baseSettings())).toBe(false);
    expect(webhook.isEnabled(baseSettings({ webhookUrl: "https://example.com/hook" }))).toBe(true);
  });

  it("email channel requires SMTP host, from, and to", () => {
    const email = findChannel("email");
    expect(email.isEnabled(baseSettings({ emailSmtpHost: "smtp.example.com" }))).toBe(false);
    expect(
      email.isEnabled(baseSettings({ emailSmtpHost: "smtp.example.com", emailFrom: "a@example.com", emailTo: "b@example.com" }))
    ).toBe(true);
  });

  it("push channel ignores notification settings entirely (no subscriptions in a fresh test DB)", () => {
    const push = findChannel("push");
    expect(push.isEnabled(baseSettings({ discordWebhookUrl: "irrelevant" }))).toBe(false);
  });
});
