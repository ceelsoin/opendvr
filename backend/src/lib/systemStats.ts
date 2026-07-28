import os from "node:os";
import fs from "node:fs/promises";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * CPU usage (%) isn't directly exposed by Node - it has to be derived from
 * the delta between two snapshots of os.cpus() times. Sampling on every
 * request (await a ~200ms delay to get a delta) would add latency to the
 * endpoint, so instead a background timer keeps a rolling snapshot and
 * `getCpuStats()` just reads the last computed value - same non-blocking
 * pattern used by the MediaMTX reconciliation loop in index.ts.
 */
interface CpuTimes {
  idle: number;
  total: number;
}

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const { user, nice, sys, idle: cpuIdle, irq } = cpu.times;
    idle += cpuIdle;
    total += user + nice + sys + cpuIdle + irq;
  }
  return { idle, total };
}

const CPU_SAMPLE_INTERVAL_MS = 2000;
let lastCpuTimes = readCpuTimes();
let cachedCpuUsagePercent = 0;

const cpuSamplerTimer = setInterval(() => {
  const current = readCpuTimes();
  const idleDelta = current.idle - lastCpuTimes.idle;
  const totalDelta = current.total - lastCpuTimes.total;
  cachedCpuUsagePercent = totalDelta > 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta))) : 0;
  lastCpuTimes = current;
}, CPU_SAMPLE_INTERVAL_MS);
// Don't keep the process alive just for this background sampler.
cpuSamplerTimer.unref();

export interface CpuStats {
  usagePercent: number;
  cores: number;
  /** 1/5/15-minute load averages (always [0,0,0] on Windows - irrelevant here, this only ever runs on Linux/Docker). */
  loadAvg: [number, number, number];
}

export function getCpuStats(): CpuStats {
  const [load1, load5, load15] = os.loadavg();
  return {
    usagePercent: Math.round(cachedCpuUsagePercent * 10) / 10,
    cores: os.cpus().length,
    loadAvg: [load1, load5, load15],
  };
}

export interface MemoryStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
}

export function getMemoryStats(): MemoryStats {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
  };
}

export interface DiskStats {
  label: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
}

async function statDisk(label: string, targetPath: string): Promise<DiskStats | null> {
  try {
    const stats = await fs.statfs(targetPath);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    return {
      label,
      path: targetPath,
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
    };
  } catch (err) {
    logger.warn({ err, targetPath }, "Failed to read disk usage stats");
    return null;
  }
}

/**
 * Reports usage for the two volumes that matter in practice (see
 * docker-compose.yml): recordings (usually the largest and fastest-growing
 * consumer) and the app's own data dir (SQLite DB + snapshots). If both
 * paths happen to resolve to the same filesystem (e.g. running outside
 * Docker without separate volumes), both entries are still returned -
 * they'll just show identical numbers, which is harmless.
 */
export async function getDiskStats(): Promise<DiskStats[]> {
  const targets = [
    { label: "Recordings", path: env.recordingsDir },
    { label: "Application data", path: env.dataDir },
  ];
  const results = await Promise.all(targets.map((t) => statDisk(t.label, t.path)));
  return results.filter((r): r is DiskStats => r !== null);
}

export interface SystemStats {
  cpu: CpuStats;
  memory: MemoryStats;
  disks: DiskStats[];
  uptimeSeconds: number;
}

export async function getSystemStats(): Promise<SystemStats> {
  return {
    cpu: getCpuStats(),
    memory: getMemoryStats(),
    disks: await getDiskStats(),
    uptimeSeconds: os.uptime(),
  };
}
