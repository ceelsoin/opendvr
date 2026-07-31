import { useTranslation } from "react-i18next";
import { useSystemStats, useProcessHealth, type TranscodeBridgeKind } from "../api/system";
import { formatBytes, formatUptime, usageColorClass } from "../lib/systemStats";

function UsageBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className={`h-full rounded-full ${usageColorClass(clamped)}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StatusDot({ ok, title }: { ok: boolean | null; title: string }) {
  return (
    <span
      title={title}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
        ok === null ? "bg-neutral-700" : ok ? "bg-green-500" : "bg-red-500"
      }`}
    />
  );
}

function bridgeKindLabel(kind: TranscodeBridgeKind, t: (key: string) => string): string {
  switch (kind) {
    case "rotation":
      return t("dashboard.bridgeRotation");
    case "timestamp":
      return t("dashboard.bridgeTimestamp");
    case "mjpeg":
      return t("dashboard.bridgeMjpeg");
    case "webpage":
      return t("dashboard.bridgeWebpage");
  }
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

      <ProcessHealthSection />
    </div>
  );
}

/**
 * Visibility into every media pipeline this backend manages (VLC relay,
 * ffmpeg transcode/timestamp/mjpeg/webpage bridges, per-camera motion
 * detectors, the shared vision worker, grid broadcasts) plus the external
 * services it depends on (MediaMTX, the configured auto-captioning
 * provider) - see backend/src/lib/processHealth.ts. Split from the
 * CPU/memory/disk section above since it polls less aggressively (10s,
 * involves live network checks) and can partially fail without blocking
 * the rest of the page.
 */
function ProcessHealthSection() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useProcessHealth();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">{t("dashboard.processesTitle")}</h2>

      {isLoading ? (
        <p className="text-sm text-neutral-400">{t("dashboard.loading")}</p>
      ) : isError || !data ? (
        <p className="text-sm text-red-400">{t("dashboard.error")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center gap-2">
                <StatusDot
                  ok={data.mediamtx.reachable}
                  title={data.mediamtx.reachable ? t("dashboard.reachable") : t("dashboard.unreachable")}
                />
                <h3 className="text-sm font-medium">{t("dashboard.mediamtxTitle")}</h3>
              </div>
              <p className="text-xs text-neutral-500">
                {data.mediamtx.reachable
                  ? t("dashboard.latencyMs", { ms: data.mediamtx.latencyMs ?? 0 })
                  : t("dashboard.unreachable")}
              </p>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center gap-2">
                <StatusDot
                  ok={data.captioning.enabled && data.captioning.configured ? data.captioning.reachable : null}
                  title={data.captioning.reachable ? t("dashboard.reachable") : t("dashboard.unreachable")}
                />
                <h3 className="text-sm font-medium">{t("dashboard.captioningTitle")}</h3>
              </div>
              <p className="text-xs text-neutral-500">
                {!data.captioning.enabled
                  ? t("dashboard.captioningDisabledStatus")
                  : !data.captioning.configured
                    ? t("dashboard.captioningNotConfiguredStatus")
                    : `${t(`settingsPage.captioningProvider${data.captioning.provider === "external" ? "External" : data.captioning.provider === "cpu" ? "Cpu" : "Gpu"}`)}${
                        data.captioning.reachable && data.captioning.latencyMs !== null
                          ? ` · ${t("dashboard.latencyMs", { ms: data.captioning.latencyMs })}`
                          : ""
                      }`}
              </p>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center gap-2">
                <StatusDot
                  ok={data.visionWorker.running}
                  title={data.visionWorker.running ? t("dashboard.workerRunning") : t("dashboard.workerStopped")}
                />
                <h3 className="text-sm font-medium">{t("dashboard.visionWorkerTitle")}</h3>
              </div>
              <p className="text-xs text-neutral-500">
                {data.visionWorker.running
                  ? t("dashboard.pendingRequests", { count: data.visionWorker.pendingRequests })
                  : t("dashboard.workerStopped")}
              </p>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center gap-2">
                <StatusDot
                  ok={data.webpageBrowserRunning}
                  title={data.webpageBrowserRunning ? t("dashboard.workerRunning") : t("dashboard.workerStopped")}
                />
                <h3 className="text-sm font-medium">{t("dashboard.webpageBrowserTitle")}</h3>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-neutral-300">{t("dashboard.cameraProcessesTitle")}</h3>
            {data.cameras.length === 0 ? (
              <p className="text-xs text-neutral-500">—</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-900 text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colCamera")}</th>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colVlcRelay")}</th>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colBridge")}</th>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colMotionWorker")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {data.cameras.map((camera) => (
                      <tr key={camera.id}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-neutral-200">{camera.name}</span>{" "}
                          <span className="text-neutral-600">({camera.sourceType})</span>
                        </td>
                        <td className="px-3 py-2">
                          {camera.vlcRelay ? (
                            <span className="flex items-center gap-1.5" title={`PID ${camera.vlcRelay.pid ?? "-"}`}>
                              <StatusDot
                                ok={camera.vlcRelay.running}
                                title={camera.vlcRelay.running ? t("dashboard.workerRunning") : t("dashboard.workerStopped")}
                              />
                              :{camera.vlcRelay.port}
                            </span>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {camera.transcodeBridge ? (
                            <span
                              className="flex items-center gap-1.5"
                              title={`PID ${camera.transcodeBridge.pid ?? "-"}`}
                            >
                              <StatusDot
                                ok={camera.transcodeBridge.running}
                                title={
                                  camera.transcodeBridge.running ? t("dashboard.workerRunning") : t("dashboard.workerStopped")
                                }
                              />
                              {bridgeKindLabel(camera.transcodeBridge.kind, t)}
                            </span>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {camera.motionWorker ? (
                            <span className="flex items-center gap-1.5" title={`PID ${camera.motionWorker.pid ?? "-"}`}>
                              <StatusDot
                                ok={camera.motionWorker.running}
                                title={camera.motionWorker.running ? t("dashboard.workerRunning") : t("dashboard.workerStopped")}
                              />
                            </span>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {data.gridBroadcasts.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-neutral-300">{t("dashboard.gridBroadcastsTitle")}</h3>
              <div className="overflow-x-auto rounded-lg border border-neutral-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-900 text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colGrid")}</th>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colMode")}</th>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colCameras")}</th>
                      <th className="px-3 py-2 font-medium">{t("dashboard.colCurrent")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {data.gridBroadcasts.map((broadcast) => (
                      <tr key={broadcast.gridId}>
                        <td className="px-3 py-2 font-medium text-neutral-200">{broadcast.name}</td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5" title={`PID ${broadcast.pid ?? "-"}`}>
                            <StatusDot
                              ok={broadcast.running}
                              title={broadcast.running ? t("dashboard.workerRunning") : t("dashboard.workerStopped")}
                            />
                            {t(broadcast.mode === "mosaic" ? "grid.broadcastModeMosaic" : "grid.broadcastModeRotation")}
                          </span>
                        </td>
                        <td className="px-3 py-2">{broadcast.cameraCount}</td>
                        <td className="px-3 py-2">
                          {broadcast.currentIndex !== null ? broadcast.currentIndex + 1 : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
