import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

const NOTIFICATION_SETTINGS_KEY = ["settings", "notifications"] as const;

export interface NotificationSettingsStatus {
  discordWebhookConfigured: boolean;
  discordAttachSnapshot: boolean;
  telegramConfigured: boolean;
  telegramAttachSnapshot: boolean;
  webhookConfigured: boolean;
  webhookAttachSnapshot: boolean;
  emailConfigured: boolean;
  emailSmtpHost: string | null;
  emailSmtpPort: number | null;
  emailSmtpUser: string | null;
  emailSmtpSecure: boolean;
  emailFrom: string | null;
  emailTo: string | null;
  emailAttachSnapshot: boolean;
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: NOTIFICATION_SETTINGS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<NotificationSettingsStatus>("/settings/notifications");
      return data;
    },
  });
}

export interface UpdateNotificationSettingsInput {
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
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateNotificationSettingsInput) => {
      const { data } = await apiClient.put<NotificationSettingsStatus>("/settings/notifications", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_SETTINGS_KEY });
    },
  });
}

export function useTestNotification() {
  return useMutation({
    mutationFn: async (channel: "discord" | "telegram" | "webhook" | "email") => {
      const { data } = await apiClient.post<{ ok: boolean; error?: string }>("/settings/notifications/test", {
        channel,
      });
      return data;
    },
  });
}
