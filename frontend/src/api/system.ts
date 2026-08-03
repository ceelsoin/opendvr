import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";

export interface CpuStats {
  usagePercent: number;
  cores: number;
  loadAvg: [number, number, number];
}

export interface MemoryStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
}

export interface DiskStats {
  label: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
}

export interface SystemStats {
  cpu: CpuStats;
  memory: MemoryStats;
  disks: DiskStats[];
  uptimeSeconds: number;
}

/** Polled every 5s - cheap to compute on the backend (see lib/systemStats.ts), no need for a longer interval. */
export function useSystemStats() {
  return useQuery({
    queryKey: ["system-stats"],
    queryFn: async () => {
      const { data } = await apiClient.get<SystemStats>("/system/stats");
      return data;
    },
    refetchInterval: 5000,
  });
}

export type CaptioningHealthProvider = "external" | "cpu" | "gpu";

export interface CaptioningHealth {
  provider: CaptioningHealthProvider;
  enabled: boolean;
  configured: boolean;
  reachable: boolean | null;
  latencyMs: number | null;
}

export interface MediaMtxHealth {
  reachable: boolean;
  latencyMs: number | null;
}

export interface VisionWorkerStatus {
  running: boolean;
  pid: number | null;
  pendingRequests: number;
}

export interface VisionModelStatus {
  yolo: boolean | null;
  faceDetect: boolean | null;
  faceRecognize: boolean | null;
}

export type TranscodeBridgeKind = "rotation" | "timestamp" | "mjpeg" | "webpage";

export interface CameraProcessStatus {
  id: string;
  name: string;
  sourceType: string;
  vlcRelay: { running: boolean; pid: number | null; port: number } | null;
  transcodeBridge: { kind: TranscodeBridgeKind; running: boolean; pid: number | null } | null;
  motionWorker: { running: boolean; pid: number | null } | null;
  objectDetection: { enabled: boolean; active: boolean } | null;
  faceRecognition: { enabled: boolean; active: boolean } | null;
}

export interface GridBroadcastProcessStatus {
  gridId: string;
  name: string;
  mode: "mosaic" | "rotation";
  running: boolean;
  pid: number | null;
  cameraCount: number;
  currentIndex: number | null;
}

export interface FrameCacheStats {
  cachedCameras: number;
  averageAgeMs: number | null;
}

export interface ProcessHealth {
  mediamtx: MediaMtxHealth;
  captioning: CaptioningHealth;
  visionWorker: VisionWorkerStatus;
  visionModels: VisionModelStatus;
  frameCache: FrameCacheStats;
  webpageBrowserRunning: boolean;
  cameras: CameraProcessStatus[];
  gridBroadcasts: GridBroadcastProcessStatus[];
}

/** Process/health visibility for VLC relay, MediaMTX, ffmpeg bridges, motion workers, the vision worker, grid broadcasts, and the captioning provider (see backend/src/lib/processHealth.ts). Polled a bit less aggressively than system stats - this involves live network checks (MediaMTX, captioning endpoint), not just a cheap local read. */
export function useProcessHealth() {
  return useQuery({
    queryKey: ["system-processes"],
    queryFn: async () => {
      const { data } = await apiClient.get<ProcessHealth>("/system/processes");
      return data;
    },
    refetchInterval: 10000,
  });
}
