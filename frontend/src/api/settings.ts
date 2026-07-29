import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

const NOTIFICATION_SETTINGS_KEY = ["settings", "notifications"] as const;
export { NOTIFICATION_SETTINGS_KEY };

export interface NotificationSettingsStatus {
  discordWebhookUrl: string | null;
  discordWebhookConfigured: boolean;
  discordAttachSnapshot: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  telegramConfigured: boolean;
  telegramAttachSnapshot: boolean;
  webhookUrl: string | null;
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
  s3Endpoint: string | null;
  s3Region: string | null;
  s3AccessKey: string | null;
  s3BucketName: string | null;
  s3Configured: boolean;
  pushConfigured: boolean;
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
  s3Endpoint?: string | null;
  s3Region?: string | null;
  s3AccessKey?: string | null;
  s3SecretKey?: string | null;
  s3BucketName?: string | null;
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
    mutationFn: async (channel: "discord" | "telegram" | "webhook" | "email" | "push") => {
      const { data } = await apiClient.post<{ ok: boolean; error?: string }>("/settings/notifications/test", {
        channel,
      });
      return data;
    },
  });
}
