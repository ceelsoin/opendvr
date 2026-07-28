import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { CameraEvent } from "./types";

const EVENTS_KEY = ["events"] as const;

export interface UseEventsFilters {
  cameraId?: string;
  type?: string;
  from?: string;
  to?: string;
}

export function useEvents(filters: UseEventsFilters = {}, enabled = true) {
  return useQuery({
    queryKey: [...EVENTS_KEY, filters],
    queryFn: async () => {
      const { data } = await apiClient.get<CameraEvent[]>("/events", { params: filters });
      return data;
    },
    enabled,
  });
}

export function useMarkEventRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, read }: { id: string; read: boolean }) => {
      const { data } = await apiClient.patch<CameraEvent>(`/events/${id}`, { read });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
    },
  });
}
