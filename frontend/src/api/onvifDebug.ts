import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface OnvifDebugCommandInfo {
  name: string;
  usage: string;
  description: string;
}

/** Lists every ONVIF command available in the debug terminal, for the /help panel and autocomplete. */
export function useOnvifDebugCommands() {
  return useQuery({
    queryKey: ["onvif-debug-commands"],
    queryFn: async () => {
      const { data } = await apiClient.get<{ commands: OnvifDebugCommandInfo[] }>("/onvif/debug/commands");
      return data.commands;
    },
    staleTime: Infinity,
  });
}

/** Executes a single ONVIF debug command against a camera (by id) - see backend/src/onvif/debugCommands.ts. */
export function useRunOnvifDebugCommand() {
  return useMutation({
    mutationFn: async ({ cameraId, command, args }: { cameraId: string; command: string; args: string[] }) => {
      const { data } = await apiClient.post<{ ok: true; result: unknown } | { ok: false; error: string }>(
        `/onvif/debug/${cameraId}`,
        { command, args }
      );
      return data;
    },
  });
}
