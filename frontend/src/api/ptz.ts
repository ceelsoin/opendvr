import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";

export type PtzDirection = "up" | "down" | "left" | "right" | "upLeft" | "upRight" | "downLeft" | "downRight";

export function usePtzMove(cameraId: string) {
  return useMutation({
    mutationFn: async ({ direction, speed }: { direction: PtzDirection; speed?: number }) => {
      await apiClient.post(`/ptz/${cameraId}/move`, { direction, speed });
    },
  });
}

/**
 * Arbitrary-angle move (pan/tilt each -1..1), used by the joystick-style
 * control (PtzJoystick) instead of the fixed 8-way `usePtzMove` buttons.
 */
export function usePtzMoveVector(cameraId: string) {
  return useMutation({
    mutationFn: async ({ pan, tilt }: { pan: number; tilt: number }) => {
      await apiClient.post(`/ptz/${cameraId}/move`, { pan, tilt });
    },
  });
}

export function usePtzStop(cameraId: string) {
  return useMutation({
    mutationFn: async () => {
      await apiClient.post(`/ptz/${cameraId}/stop`);
    },
  });
}

export interface PtzPreset {
  token: string;
  name?: string;
}

export function usePtzPresets(cameraId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ptz-presets", cameraId],
    queryFn: async () => {
      const { data } = await apiClient.get<PtzPreset[]>(`/ptz/${cameraId}/presets`);
      return data;
    },
    enabled,
  });
}

export function usePtzGotoPreset(cameraId: string) {
  return useMutation({
    mutationFn: async (token: string) => {
      await apiClient.post(`/ptz/${cameraId}/presets/${token}/goto`);
    },
  });
}

export function usePtzSavePreset(cameraId: string) {
  return useMutation({
    mutationFn: async (name: string) => {
      await apiClient.post(`/ptz/${cameraId}/presets`, { name });
    },
  });
}
