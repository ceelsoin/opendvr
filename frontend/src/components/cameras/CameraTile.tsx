import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import {
  useCameraStreamStatus,
  useDisableCamera,
  useEnableCamera,
  useRestartCamera,
  useTestCameraConnection,
} from "../../api/cameras";
import { useStreamSettings } from "../../api/streamSettings";
import type { Camera } from "../../api/types";
import { HlsPlayer } from "../player/HlsPlayer";
import { useCameraEventStore } from "../../store/cameraEventStore";
import { usePtzTargetStore } from "../../store/ptzTargetStore";
import { useToastStore } from "../../store/toastStore";
import { CameraFormDialog } from "./CameraFormDialog";

function extractErrorMessage(err: unknown, fallback: string): string {
  const data = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: string } | undefined) : undefined;
  const base = data?.error ?? fallback;
  return data?.details ? `${base} (${data.details})` : base;
}

/** Same convention used in CameraFormDialog: never include the password (not sent to the client). */
function onvifUrlDisplay(camera: Camera): string {
  return `http://${camera.username}@${camera.host}:${camera.port}${camera.onvifPath}`;
}

function resolutionDisplay(camera: Camera, t: (key: string) => string): string {
  if (!camera.mainStreamWidth || !camera.mainStreamHeight) return t("cameras.unknownResolution");
  return `${camera.mainStreamWidth}x${camera.mainStreamHeight}${camera.mainStreamEncoding ? ` (${camera.mainStreamEncoding})` : ""}`;
}

/**
 * `camera.status` only reflects whether ONVIF connected and a path got
 * registered in MediaMTX - it says nothing about whether MediaMTX actually
 * managed to open the RTSP connection to the camera (a separate
 * negotiation, see docs/troubleshooting.md). The dot must also take the
 * live `ready` flag from stream-status into account, otherwise it shows
 * green even while the RTSP source is still down.
 */
function statusDotColor(camera: Camera, ready: boolean | undefined): string {
  if (!camera.enabled) return "bg-neutral-700";
  if (camera.status === "offline") return "bg-red-500";
  if (camera.status === "unknown" || ready === undefined) return "bg-neutral-500";
  return ready ? "bg-green-500" : "bg-amber-500";
}

function statusDotTitle(camera: Camera, ready: boolean | undefined, t: (key: string) => string): string {
  if (!camera.enabled) return t("cameras.statusDisabledTitle");
  if (camera.status === "offline") return t("cameras.statusOfflineTitle");
  if (camera.status === "unknown" || ready === undefined) return t("cameras.statusUnknownTitle");
  return ready ? t("cameras.statusReadyTitle") : t("cameras.statusNotReadyTitle");
}

export function CameraTile({ camera, fillHeight = false }: { camera: Camera; fillHeight?: boolean }) {
  const { t } = useTranslation();
  const [showStatus, setShowStatus] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  // Bumped to force the HlsPlayer below to fully unmount/remount (via its
  // `key`), tearing down and recreating the hls.js instance - the "refresh"
  // action asked for by users when the player gets stuck without the whole
  // page needing a reload.
  const [reloadKey, setReloadKey] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Grid tiles load the lighter sub-stream (when the camera has one and the
  // Settings page's "prefer sub-stream in grid" toggle is on) for faster/
  // lighter loading, switching to the full-quality main stream in
  // fullscreen - see api/streamSettings.ts and media/provisioning.ts's
  // `provisionSubStreamPath` on the backend.
  const { data: streamSettings } = useStreamSettings();
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);
  // Must mirror media/provisioning.ts's `provisionSubStreamPath` eligibility
  // check exactly - it never registers a `_sub` path for vlc-relay cameras
  // (single-RTSP-session OEM cameras, see media/vlcRelay.ts), even if a
  // sub-stream profile was otherwise resolved via ONVIF. Requesting a `_sub`
  // path that was never provisioned makes MediaMTX's HLS server 404 with
  // `{"error":"path '..._sub' is not configured"}`.
  const usesSubStream =
    !isFullscreen &&
    streamSettings?.preferSubStreamInGrid &&
    Boolean(camera.subStreamWidth) &&
    camera.rtspCompatMode !== "vlc-relay";
  const hlsPathName = usesSubStream ? `${camera.id}_sub` : camera.id;

  // Always polled (not just when the "diagnóstico" panel is open) so the
  // status dot reflects real RTSP readiness, not just camera.status. Not
  // worth polling for an administratively disabled camera - there's no
  // stream to check.
  const streamStatus = useCameraStreamStatus(camera.id, camera.enabled && camera.status !== "offline");
  const isFlashing = useCameraEventStore((s) => s.flashingCameraIds.has(camera.id));
  const isPtzTarget = usePtzTargetStore((s) => s.target?.id === camera.id);
  const togglePtzTarget = usePtzTargetStore((s) => s.toggleTarget);
  const addToast = useToastStore((s) => s.addToast);

  const enableCamera = useEnableCamera();
  const disableCamera = useDisableCamera();
  const restartCamera = useRestartCamera();
  const testConnection = useTestCameraConnection();

  // Same terminal-log look as the "Testar conexão"/restart LogModal, but
  // for this locally-computed diagnostic info (no backend log tailing
  // involved) - lines are revealed one at a time when the panel is opened,
  // instead of dumping the whole list at once, for the same "live log" feel.
  const diagnosticLines = useMemo(() => {
    if (!streamStatus.data) return [t("cameras.diagnosticLoading")];
    const d = streamStatus.data;
    const lines = [
      t("cameras.diagnosticConfiguredPath", { value: d.configured ? t("cameras.yes") : t("cameras.no") }),
      t("cameras.diagnosticReady", { value: d.ready ? t("cameras.yes") : t("cameras.no") }),
      t("cameras.diagnosticSourceType", { value: d.sourceType ?? "-" }),
      t("cameras.diagnosticReaders", { value: d.readerCount }),
      t("cameras.diagnosticBytes", { value: d.bytesReceived }),
      t("cameras.diagnosticOnvifUrl", { value: onvifUrlDisplay(camera) }),
      t("cameras.diagnosticRtspUrl", { value: camera.rtspMainUri ?? "-" }),
      t("cameras.diagnosticResolution", { value: resolutionDisplay(camera, t) }),
    ];
    if (camera.rtspCompatMode === "vlc-relay") {
      lines.push(t("cameras.diagnosticRelayUrl", { value: d.relayUrl ?? t("cameras.diagnosticRelayNotRunning") }));
    }
    return lines;
  }, [streamStatus.data, camera, t]);

  const diagnosticLinesRef = useRef(diagnosticLines);
  useEffect(() => {
    diagnosticLinesRef.current = diagnosticLines;
  }, [diagnosticLines]);

  // Reveals one diagnostic line at a time, restarting from scratch every
  // time the panel is (re)opened - each entry's timestamp is captured at
  // reveal time (not tied to any real backend event), just for the "log
  // being generated live" feel to match LogModal.
  const [revealedLines, setRevealedLines] = useState<{ time: number }[]>([]);
  const diagnosticLogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showStatus) {
      setRevealedLines([]);
      return;
    }
    setRevealedLines([]);
    const interval = setInterval(() => {
      setRevealedLines((prev) => {
        if (prev.length >= diagnosticLinesRef.current.length) return prev;
        return [...prev, { time: Date.now() }];
      });
    }, 150);
    return () => clearInterval(interval);
  }, [showStatus]);

  useEffect(() => {
    diagnosticLogRef.current?.scrollTo({ top: diagnosticLogRef.current.scrollHeight });
  }, [revealedLines]);

  // Closes the context menu on any click elsewhere or on Escape.
  useEffect(() => {
    if (!contextMenuPos) return;
    const closeMenu = () => setContextMenuPos(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenuPos]);

  const handleOpenContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Stops the native event from bubbling up to the window-level
    // "contextmenu" listener registered below (which closes any
    // already-open menu) - without this, re-right-clicking the same tile
    // while its menu is open would set + immediately unset the position in
    // the same synchronous dispatch, closing the menu instead of moving it.
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleFullscreen = () => {
    setContextMenuPos(null);
    containerRef.current?.requestFullscreen().catch(() => {
      addToast("error", t("cameras.fullscreenFailedToast"));
    });
  };

  const handleRefreshPlayer = () => {
    setContextMenuPos(null);
    setReloadKey((k) => k + 1);
  };

  /** Opens the same dropdown used by right-click, anchored under the tapped "⋮" button - the discoverable equivalent of the context menu on touch devices, which have no right-click/contextmenu gesture. */
  const handleOpenContextMenuFromButton = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenuPos({ x: rect.left, y: rect.bottom + 4 });
  };

  const handleToggleEnabled = () => {
    setContextMenuPos(null);
    if (camera.enabled) {
      disableCamera.mutate(camera.id, {
        onSuccess: () => addToast("success", `${camera.name}: ${t("cameras.toastDisabled")}`),
        onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.toastDisableFailed"))}`),
      });
    } else {
      enableCamera.mutate(camera.id, {
        onSuccess: (data) => {
          addToast(
            data.status === "online" ? "success" : "error",
            `${camera.name}: ${t("cameras.toastEnabled")}${data.status !== "online" ? t("cameras.toastEnabledOfflineSuffix") : ""}`
          );
        },
        onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.toastEnableFailed"))}`),
      });
    }
  };

  const handleRestart = () => {
    setContextMenuPos(null);
    restartCamera.mutate(camera.id, {
      onSuccess: (data) => {
        addToast(
          data.ok ? "success" : "error",
          `${camera.name}: ${data.ok ? t("cameras.toastRestarted", { status: data.status }) : t("cameras.toastRestartedOffline", { status: data.status })}`
        );
      },
      onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.toastRestartFailed"))}`),
    });
  };

  const handleTestConnection = () => {
    setContextMenuPos(null);
    testConnection.mutate(camera.id, {
      onSuccess: (data) => addToast("success", `${camera.name}: ${t("cameras.toastConnected", { count: data.streams?.length ?? 0 })}`),
      onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.testConnectionFailed"))}`),
    });
  };

  const showOffline = !camera.enabled || camera.status === "offline";

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-lg border bg-neutral-900 transition-shadow ${fillHeight ? "flex h-full flex-col" : ""} ${
        isPtzTarget
          ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.5)]"
          : isFlashing
            ? "border-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.5)]"
            : "border-neutral-800"
      }`}
    >
      <div
        className={`group relative bg-black text-neutral-600 ${fillHeight ? "min-h-0 flex-1" : "aspect-video"}`}
        onContextMenu={handleOpenContextMenu}
      >
        {showOffline ? (
          <div className="flex h-full w-full items-center justify-center text-sm">
            {!camera.enabled ? t("cameras.statusDisabledTitle") : t("cameras.statusOfflineTitle")}
          </div>
        ) : (
          <HlsPlayer key={reloadKey} src={`/hls/${hlsPathName}/index.m3u8`} className="h-full w-full" />
        )}
        {!showOffline && camera.recordingMode === "continuous" && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs font-medium text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {t("cameras.recordingBadge")}
          </div>
        )}
        {!showOffline && camera.recordingMode === "motion" && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs font-medium text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {t("cameras.motionRecordingBadge")}
          </div>
        )}
        {/* Always visible (not hover-reveal) so it's discoverable on touch devices, which have no right-click/contextmenu gesture to fall back on. */}
        <button
          type="button"
          onClick={handleOpenContextMenuFromButton}
          title={t("cameras.moreOptions")}
          className="absolute left-2 top-2 rounded bg-black/60 p-1 text-neutral-300 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </svg>
        </button>
        {!showOffline && (
          <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={handleRefreshPlayer}
              title={t("cameras.refreshPlayer")}
              className="rounded bg-black/60 p-1.5 text-neutral-300 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleFullscreen}
              title={t("cameras.fullscreenTitle")}
              className="rounded bg-black/60 p-1.5 text-neutral-300 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 0 0-2 2v4m18 0V5a2 2 0 0 0-2-2h-4m0 18h4a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2h4" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between p-3">
        <span className="text-sm font-medium">
          {camera.name} <span className="text-xs font-normal text-neutral-500">({camera.host})</span>
        </span>
        <div className="flex items-center gap-2">
          {camera.hasPtz && (
            <button
              type="button"
              onClick={() => togglePtzTarget({ id: camera.id, name: camera.name })}
              title={isPtzTarget ? t("cameras.ptzControlTitleOn") : t("cameras.ptzControlTitleOff")}
              className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                isPtzTarget
                  ? "bg-blue-600 text-white"
                  : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              }`}
            >
              {t("cameras.ptzButton")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowStatus((v) => !v)}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            {t("cameras.diagnosticToggle")}
          </button>
          <span
            title={statusDotTitle(camera, streamStatus.data?.ready, t)}
            className={`h-2 w-2 rounded-full ${statusDotColor(camera, streamStatus.data?.ready)}`}
          />
        </div>
      </div>
      {showStatus && (
        <div className="border-t border-neutral-800 p-3">
          <div
            ref={diagnosticLogRef}
            className="max-h-56 overflow-y-auto rounded-md border border-neutral-800 bg-black p-3 font-mono text-xs"
          >
            {revealedLines.length === 0 && (
              <p className="text-neutral-600">{t("cameras.diagnosticLoading")}</p>
            )}
            {diagnosticLines.slice(0, revealedLines.length).map((line, i) => (
              <div key={i} className="mb-1 whitespace-pre-wrap break-all">
                <span className="text-neutral-600">[{new Date(revealedLines[i].time).toLocaleTimeString()}]</span>{" "}
                <span className="text-neutral-300">INFO</span> <span className="text-neutral-200">{line}</span>
              </div>
            ))}
            {revealedLines.length > 0 && revealedLines.length < diagnosticLines.length && (
              <span className="animate-pulse text-neutral-600">▋</span>
            )}
          </div>
        </div>
      )}
      {isEditing && <CameraFormDialog camera={camera} onClose={() => setIsEditing(false)} />}
      {contextMenuPos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: Math.min(contextMenuPos.y, window.innerHeight - 260),
              left: Math.min(contextMenuPos.x, window.innerWidth - 200),
            }}
            className="z-50 w-48 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-lg"
          >
            <button
              type="button"
              onClick={handleFullscreen}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              {t("cameras.fullscreenTitle")}
            </button>
            <button
              type="button"
              onClick={handleRefreshPlayer}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              {t("cameras.refreshPlayer")}
            </button>
            <button
              type="button"
              onClick={handleToggleEnabled}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              {camera.enabled ? t("cameras.contextTurnOff") : t("cameras.contextTurnOn")}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              disabled={!camera.enabled}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("cameras.restart")}
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              {t("cameras.testConnection")}
            </button>
            <div className="my-1 border-t border-neutral-800" />
            <button
              type="button"
              onClick={() => {
                setContextMenuPos(null);
                setIsEditing(true);
              }}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              {t("cameras.contextEdit")}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
