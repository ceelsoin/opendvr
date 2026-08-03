import { discordChannel } from "./discord.js";
import { telegramChannel } from "./telegram.js";
import { genericWebhookChannel } from "./genericWebhook.js";
import { emailChannel } from "./email.js";
import { webPushChannel } from "./webPushChannel.js";
import type { NotificationChannel } from "./channel.js";

/**
 * Every notification channel this app ships with, in the common
 * NotificationChannel shape (see channel.ts) - webhooks.ts iterates this
 * instead of calling each channel's send function by name. Adding a new
 * channel (MQTT, Home Assistant, etc. - see plans/04-event-bus-plugins.md)
 * only requires implementing NotificationChannel and adding it here; no
 * changes needed in webhooks.ts or events/cameraEvents.ts.
 */
export const channels: NotificationChannel[] = [discordChannel, telegramChannel, genericWebhookChannel, emailChannel, webPushChannel];
