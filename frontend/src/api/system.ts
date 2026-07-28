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
