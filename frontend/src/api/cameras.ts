import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import type {
  Camera,
  CreateCameraInput,
  DiscoveredCamera,
  OnvifProbeResult,
  UpdateCameraInput,
} from "./types";

const CAMERAS_KEY = ["cameras"] as const;

export function useCameras() {
  return useQuery({
    queryKey: CAMERAS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<Camera[]>("/cameras");
      return data;
    },
  });
}

export function useCreateCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCameraInput) => {
      const { data } = await apiClient.post<Camera>("/cameras", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

export function useUpdateCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCameraInput }) => {
      const { data } = await apiClient.patch<Camera>(`/cameras/${id}`, input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

export function useDeleteCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/cameras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

export function useTestCameraConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(`/cameras/${id}/test-connection`);
      return data as { ok: true; streams: OnvifProbeResult["streams"] };
    },
  });
}

export interface CameraStreamStatus {
  configured: boolean;
  ready: boolean;
  sourceType: string | null;
  readerCount: number;
  bytesReceived: number;
  hlsUrl: string;
  relayUrl: string | null;
}

/** Live view of MediaMTX's actual stream state for a camera (is the RTSP source really connected?). */
export function useCameraStreamStatus(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["camera-stream-status", id],
    queryFn: async () => {
      const { data } = await apiClient.get<CameraStreamStatus>(`/cameras/${id}/stream-status`);
      return data;
    },
    enabled,
    refetchInterval: 3000,
  });
}

export function useRestartCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(`/cameras/${id}/restart`);
      return data as { ok: boolean; status: Camera["status"] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

/** Administrative on/off switch (distinct from `status`, which reflects connectivity) - tears down MediaMTX path/motion listener/VLC relay but keeps the camera's config. */
export function useDisableCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<Camera>(`/cameras/${id}/disable`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

/** Re-enables a previously disabled camera: re-provisions it and resumes motion detection if configured. */
export function useEnableCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<Camera>(`/cameras/${id}/enable`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

export function useDiscoverCameras() {
  return useMutation<DiscoveredCamera[], Error, number | void>({
    mutationFn: async (timeoutMs = 5000) => {
      const { data } = await apiClient.post<DiscoveredCamera[]>("/discovery", { timeoutMs });
      return data;
    },
  });
}

export interface ProbeOnvifInput {
  onvifUrl?: string;
  host?: string;
  port?: number;
  onvifPath?: string;
  username?: string;
  password?: string;
}

/** Connects via ONVIF and lists the camera's available stream profiles, without saving anything. */
export function useProbeOnvif() {
  return useMutation({
    mutationFn: async (input: ProbeOnvifInput) => {
      const { data } = await apiClient.post<OnvifProbeResult>("/onvif/probe", input);
      return data;
    },
  });
}

export interface ProbeCameraInput {
  host?: string;
  port?: number;
  onvifPath?: string;
  username?: string;
  password?: string;
}

/**
 * Same as `useProbeOnvif`, but scoped to an already-registered camera: any
 * field left out falls back to that camera's saved value (including its
 * password) - used by the edit dialog so re-discovering streams doesn't
 * require retyping a password that's already stored.
 */
export function useProbeCamera() {
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ProbeCameraInput }) => {
      const { data } = await apiClient.post<OnvifProbeResult>(`/cameras/${id}/probe`, input);
      return data;
    },
  });
}


export interface SoapDiagnosticAttempt {
  label: string;
  ok: boolean;
  statusCode?: number;
  bodyPreview?: string;
  error?: string;
}

export interface SoapDiagnosticResult {
  host: string;
  port: number;
  onvifPath: string;
  results: SoapDiagnosticAttempt[];
}

/**
 * Diagnostic-only: tests raw SOAP 1.1 vs SOAP 1.2 compatibility against the
 * camera's ONVIF endpoint, bypassing the regular ONVIF client entirely.
 * Useful when the regular probe fails with "socket hang up"/ECONNRESET.
 */
export function useDiagnoseOnvif() {
  return useMutation({
    mutationFn: async (
      input: Pick<ProbeOnvifInput, "onvifUrl" | "host" | "port" | "onvifPath" | "username" | "password">
    ) => {
      const { data } = await apiClient.post<SoapDiagnosticResult>("/onvif/diagnose", input);
      return data;
    },
  });
}

