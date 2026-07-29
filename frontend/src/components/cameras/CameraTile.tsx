import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import {
  useCameraStreamStatus,
  useDisableCamera,
  useEnableCamera,
  useRestartCamera,
  useTestCameraConnection,
} from "../../api/cameras";
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

function resolutionDisplay(camera: Camera): string {
  if (!camera.mainStreamWidth || !camera.mainStreamHeight) return "desconhecida";
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

function statusDotTitle(camera: Camera, ready: boolean | undefined): string {
  if (!camera.enabled) return "Câmera desativada";
  if (camera.status === "offline") return "Câmera offline";
  if (camera.status === "unknown" || ready === undefined) return "Status desconhecido";
  return ready ? "Fonte RTSP conectada" : "ONVIF ok, mas a fonte RTSP ainda não conectou";
}

export function CameraTile({ camera }: { camera: Camera }) {
  const [showStatus, setShowStatus] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
      addToast("error", "Não foi possível entrar em tela cheia.");
    });
  };

  const handleToggleEnabled = () => {
    setContextMenuPos(null);
    if (camera.enabled) {
      disableCamera.mutate(camera.id, {
        onSuccess: () => addToast("success", `${camera.name}: câmera desligada.`),
        onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, "Falha ao desligar a câmera.")}`),
      });
    } else {
      enableCamera.mutate(camera.id, {
        onSuccess: (data) => {
          addToast(
            data.status === "online" ? "success" : "error",
            `${camera.name}: câmera ligada${data.status !== "online" ? ", mas ficou offline (verifique host/credenciais)" : ""}.`
          );
        },
        onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, "Falha ao ligar a câmera.")}`),
      });
    }
  };

  const handleRestart = () => {
    setContextMenuPos(null);
    restartCamera.mutate(camera.id, {
      onSuccess: (data) => {
        addToast(
          data.ok ? "success" : "error",
          `${camera.name}: ${data.ok ? "reiniciada com sucesso" : `reiniciou mas ficou offline (status: ${data.status})`}.`
        );
      },
      onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, "Falha ao reiniciar a câmera.")}`),
    });
  };

  const handleTestConnection = () => {
    setContextMenuPos(null);
    testConnection.mutate(camera.id, {
      onSuccess: (data) => addToast("success", `${camera.name}: conectado — ${data.streams?.length ?? 0} stream(s) encontrado(s).`),
      onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, "Falha ao testar a conexão com a câmera.")}`),
    });
  };

  const showOffline = !camera.enabled || camera.status === "offline";

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-lg border bg-neutral-900 transition-shadow ${
        isPtzTarget
          ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.5)]"
          : isFlashing
            ? "border-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.5)]"
            : "border-neutral-800"
      }`}
    >
      <div
        className="group relative aspect-video bg-black text-neutral-600"
        onContextMenu={handleOpenContextMenu}
      >
        {showOffline ? (
          <div className="flex h-full w-full items-center justify-center text-sm">
            {!camera.enabled ? "Câmera desativada" : "Câmera offline"}
          </div>
        ) : (
          <HlsPlayer src={`/hls/${camera.id}/index.m3u8`} className="h-full w-full" />
        )}
        {!showOffline && camera.recordingMode === "continuous" && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs font-medium text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Gravando
          </div>
        )}
        {!showOffline && camera.recordingMode === "motion" && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs font-medium text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Gravação por movimento
          </div>
        )}
        {!showOffline && (
          <button
            type="button"
            onClick={handleFullscreen}
            title="Tela cheia"
            className="absolute bottom-2 right-2 rounded bg-black/60 p-1.5 text-neutral-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 0 0-2 2v4m18 0V5a2 2 0 0 0-2-2h-4m0 18h4a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2h4" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between p-3">
        <span className="text-sm font-medium">
          {camera.name} <span className="text-xs font-normal text-neutral-500">({camera.host})</span>
        </span>
        <div className="flex items-center gap-2">
          {camera.hasPtz && (
            <button
              type="button"
              onClick={() => togglePtzTarget({ id: camera.id, name: camera.name })}
              title={isPtzTarget ? "Parar de controlar esta câmera (PTZ)" : "Controlar esta câmera (PTZ)"}
              className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                isPtzTarget
                  ? "bg-blue-600 text-white"
                  : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              }`}
            >
              PTZ
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowStatus((v) => !v)}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            diagnóstico
          </button>
          <span
            title={statusDotTitle(camera, streamStatus.data?.ready)}
            className={`h-2 w-2 rounded-full ${statusDotColor(camera, streamStatus.data?.ready)}`}
          />
        </div>
      </div>
      {showStatus && (
        <div className="border-t border-neutral-800 p-3 text-xs text-neutral-400">
          {streamStatus.data ? (
            <ul className="flex flex-col gap-0.5">
              <li>Path configurado no MediaMTX: {streamStatus.data.configured ? "sim" : "não"}</li>
              <li>Fonte RTSP conectada (ready): {streamStatus.data.ready ? "sim" : "não"}</li>
              <li>Tipo de fonte: {streamStatus.data.sourceType ?? "-"}</li>
              <li>Leitores conectados: {streamStatus.data.readerCount}</li>
              <li>Bytes recebidos: {streamStatus.data.bytesReceived}</li>
              <li className="mt-1 break-all font-mono">URL ONVIF: {onvifUrlDisplay(camera)}</li>
              <li className="break-all font-mono">URL RTSP (fonte): {camera.rtspMainUri ?? "-"}</li>
              <li>Resolução: {resolutionDisplay(camera)}</li>
              {camera.rtspCompatMode === "vlc-relay" && (
                <li className="break-all font-mono">URL do relay VLC: {streamStatus.data.relayUrl ?? "não está rodando"}</li>
              )}
            </ul>
          ) : (
            <p>Carregando status...</p>
          )}
        </div>
      )}
      {isEditing && <CameraFormDialog camera={camera} onClose={() => setIsEditing(false)} />}
      {contextMenuPos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: Math.min(contextMenuPos.y, window.innerHeight - 220),
              left: Math.min(contextMenuPos.x, window.innerWidth - 200),
            }}
            className="z-50 w-48 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-lg"
          >
            <button
              type="button"
              onClick={handleFullscreen}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              Tela cheia
            </button>
            <button
              type="button"
              onClick={handleToggleEnabled}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              {camera.enabled ? "Desligar câmera" : "Ligar câmera"}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              disabled={!camera.enabled}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reiniciar
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
            >
              Testar conexão
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
              Editar câmera
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
