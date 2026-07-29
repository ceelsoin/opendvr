import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

const STREAM_SETTINGS_KEY = ["settings", "stream"] as const;

export type HlsVariant = "mpegts" | "fmp4" | "lowLatency";

export interface StreamSettings {
  hlsVariant: HlsVariant;
  hlsSegmentCount: number;
  hlsSegmentDuration: string;
  hlsPartDuration: string;
  hlsSegmentMaxSize: string;
  hlsAlwaysRemux: boolean;
  hlsMuxerCloseAfter: string;
  preferSubStreamInGrid: boolean;
  playerLiveSyncDurationCount: number;
  playerMaxBufferLength: number;
}

/** Cached/shared across every mounted HlsPlayer/CameraTile instance - only one network request regardless of how many camera tiles are on screen. */
export function useStreamSettings() {
  return useQuery({
    queryKey: STREAM_SETTINGS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<StreamSettings>("/settings/stream");
      return data;
    },
    staleTime: 30_000,
  });
}

export function useUpdateStreamSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<StreamSettings>) => {
      const { data } = await apiClient.put<StreamSettings>("/settings/stream", input);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(STREAM_SETTINGS_KEY, data);
    },
  });
}
