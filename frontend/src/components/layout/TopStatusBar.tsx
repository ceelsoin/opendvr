import { Link } from "react-router-dom";
import { useSystemStats } from "../../api/system";
import { formatBytes, usageColorClass } from "../../lib/systemStats";

function Metric({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div className="flex items-center gap-1.5" title={detail}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${usageColorClass(percent)}`} />
      <span className="text-neutral-500">{label}</span>
      <span className="tabular-nums text-neutral-300">{percent.toFixed(0)}%</span>
    </div>
  );
}

/**
 * Compact always-visible summary of the same CPU/memory/disk stats shown in
 * full on DashboardPage - click-through link to see full detail. Lives in
 * AppLayout (like the sidebar nav) so it appears on every screen except the
 * kiosk custom-grid view, which deliberately has no chrome at all.
 */
export function TopStatusBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { data } = useSystemStats();

  return (
    <header className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-4 text-xs">
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Abrir menu"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 md:hidden"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
      <div className="flex flex-1 items-center justify-end gap-4">
      {data ? (
        <Link to="/dashboard" className="flex items-center gap-4 hover:opacity-80">
          <Metric
            label="CPU"
            percent={data.cpu.usagePercent}
            detail={`${data.cpu.cores} núcleo(s) · carga: ${data.cpu.loadAvg.map((v) => v.toFixed(2)).join(" / ")}`}
          />
          <Metric
            label="Mem"
            percent={data.memory.usagePercent}
            detail={`${formatBytes(data.memory.usedBytes)} de ${formatBytes(data.memory.totalBytes)}`}
          />
          {data.disks.slice(0, 1).map((disk) => (
            <Metric
              key={disk.path}
              label="Disco"
              percent={disk.usagePercent}
              detail={`${disk.label}: ${formatBytes(disk.usedBytes)} de ${formatBytes(disk.totalBytes)}`}
            />
          ))}
        </Link>
      ) : (
        <span className="text-neutral-600">Carregando estatísticas...</span>
      )}
      </div>
    </header>
  );
}
