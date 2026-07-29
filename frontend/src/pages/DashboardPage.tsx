import { useTranslation } from "react-i18next";
import { useSystemStats } from "../api/system";
import { formatBytes, formatUptime, usageColorClass } from "../lib/systemStats";

function UsageBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className={`h-full rounded-full ${usageColorClass(clamped)}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StatCard({
  title,
  subtitle,
  percent,
  children,
}: {
  title: string;
  subtitle: string;
  percent: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-lg font-semibold tabular-nums">{percent.toFixed(1)}%</span>
      </div>
      <UsageBar percent={percent} />
      <p className="text-xs text-neutral-500">{subtitle}</p>
      {children}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useSystemStats();

  if (isLoading) {
    return <p className="text-neutral-400">{t("dashboard.loading")}</p>;
  }

  if (isError || !data) {
    return <p className="text-red-400">{t("dashboard.error")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">{t("dashboard.title")}</h2>
        <p className="text-sm text-neutral-500">
          {t("dashboard.description", { uptime: formatUptime(data.uptimeSeconds) })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={t("dashboard.cpu")}
          percent={data.cpu.usagePercent}
          subtitle={t("dashboard.cpuDetail", {
            cores: data.cpu.cores,
            load: data.cpu.loadAvg.map((v) => v.toFixed(2)).join(" / "),
          })}
        />

        <StatCard
          title={t("dashboard.memory")}
          percent={data.memory.usagePercent}
          subtitle={t("dashboard.memoryDetail", { used: formatBytes(data.memory.usedBytes), total: formatBytes(data.memory.totalBytes) })}
        />

        {data.disks.map((disk) => (
          <StatCard
            key={disk.path}
            title={t("dashboard.diskTitle", { label: disk.label })}
            percent={disk.usagePercent}
            subtitle={t("dashboard.diskDetail", { used: formatBytes(disk.usedBytes), total: formatBytes(disk.totalBytes) })}
          >
            <p className="break-all font-mono text-[11px] text-neutral-600">{disk.path}</p>
          </StatCard>
        ))}
      </div>
    </div>
  );
}
