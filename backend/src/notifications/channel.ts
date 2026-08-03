import type { Camera } from "../types/camera.js";
import type { NotificationSettings } from "./notificationSettings.js";

/**
 * Common shape every notification channel consumes, instead of each
 * accepting its own hand-matched positional arguments - see
 * plans/04-event-bus-plugins.md. Built once per notification in
 * webhooks.ts, then handed to every applicable channel's `send()`.
 */
export interface NotificationEvent {
  kind: "camera_event" | "camera_unavailable" | "camera_recovered" | "test";
  camera: Pick<Camera, "id" | "name">;
  /** Raw topic (e.g. "object:person", "camera.unavailable", "camera.recovered", "test") - for channels that want machine-readable context, not just the human message (see genericWebhook.ts). */
  topic: string;
  /** Already-localized/formatted human-readable text. */
  message: string;
  /** Precomputed subject/title line (email subject, push notification title) - varies by `kind` and translation, so the caller builds it once. */
  subject: string;
  occurredAt: string;
  snapshot?: Buffer;
  snapshotUrl?: string;
  recordingLink?: string;
  clip?: Buffer;
  caption?: string;
}

export type NotificationChannelId = "discord" | "telegram" | "webhook" | "email" | "push";

export interface NotificationChannel {
  readonly id: NotificationChannelId;
  isEnabled(settings: NotificationSettings): boolean;
  send(event: NotificationEvent): Promise<void>;
}
