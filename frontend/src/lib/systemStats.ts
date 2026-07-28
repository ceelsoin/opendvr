/** Shared formatting helpers for system resource stats (used by DashboardPage and TopStatusBar). */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

/** Same red/amber/green thresholds used across the app's other status indicators. */
export function usageColorClass(percent: number, kind: "bg" | "text" = "bg"): string {
  if (percent >= 90) return kind === "bg" ? "bg-red-500" : "text-red-400";
  if (percent >= 70) return kind === "bg" ? "bg-amber-500" : "text-amber-400";
  return kind === "bg" ? "bg-green-500" : "text-green-400";
}
