import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface RecordingSegment {
  /** ISO 8601 start timestamp. */
  start: string;
  /** Duration in seconds. */
  duration: number;
  /** Proxied playback URL (this backend's own origin, see app.ts's /recordings proxy). */
  url: string;
}

/** Lists recorded segments for a camera within [start, end] (ISO 8601), read from MediaMTX's Playback server. */
export function useRecordings(cameraId: string, start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["recordings", cameraId, start, end],
    queryFn: async () => {
      const { data } = await apiClient.get<RecordingSegment[]>(`/recordings/${cameraId}`, {
        params: { start, end },
      });
      return data;
    },
    enabled: enabled && Boolean(cameraId),
  });
}
