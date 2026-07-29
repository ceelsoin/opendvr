import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import { NOTIFICATION_SETTINGS_KEY } from "./settings";

/** The server's VAPID public key, needed to create a `PushSubscription` (see src/lib/push.ts). */
export function useVapidPublicKey() {
  return useQuery({
    queryKey: ["push", "vapid-public-key"] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<{ publicKey: string }>("/push/vapid-public-key");
      return data.publicKey;
    },
    // The key pair is generated once and persisted server-side (see
    // backend/src/lib/webPush.ts) - no need to ever refetch it.
    staleTime: Infinity,
  });
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function useSubscribePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (subscription: PushSubscriptionPayload) => {
      const { data } = await apiClient.post<{ ok: boolean }>("/push/subscribe", subscription);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_SETTINGS_KEY });
    },
  });
}

export function useUnsubscribePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (endpoint: string) => {
      const { data } = await apiClient.post<{ ok: boolean }>("/push/unsubscribe", { endpoint });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_SETTINGS_KEY });
    },
  });
}
