import { useMutation } from "@tanstack/react-query";
import { apiClient } from "./client";

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      const { data } = await apiClient.post("/maintenance/change-password", input);
      return data as { ok: boolean };
    },
  });
}

export function useRestartServer() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post("/maintenance/restart-server");
      return data as { ok: boolean };
    },
  });
}

export function useFactoryReset() {
  return useMutation({
    mutationFn: async (password: string) => {
      const { data } = await apiClient.post("/maintenance/factory-reset", { password });
      return data as { ok: boolean };
    },
  });
}

/** Deletes recorded video files for one camera, or every camera (`cameraId` omitted). */
export function useDeleteRecordings() {
  return useMutation({
    mutationFn: async (cameraId: string | undefined) => {
      const { data } = await apiClient.post("/maintenance/recordings/delete", { cameraId });
      return data as { ok: boolean };
    },
  });
}
