import { useState } from "react";
import { useCameraStreamStatus } from "../../api/cameras";
import type { Camera } from "../../api/types";
import { HlsPlayer } from "../player/HlsPlayer";
import { useCameraEventStore } from "../../store/cameraEventStore";
import { usePtzTargetStore } from "../../store/ptzTargetStore";

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
  if (camera.status === "offline") return "bg-red-500";
  if (camera.status === "unknown" || ready === undefined) return "bg-neutral-500";
  return ready ? "bg-green-500" : "bg-amber-500";
}

function statusDotTitle(camera: Camera, ready: boolean | undefined): string {
  if (camera.status === "offline") return "Câmera offline";
  if (camera.status === "unknown" || ready === undefined) return "Status desconhecido";
  return ready ? "Fonte RTSP conectada" : "ONVIF ok, mas a fonte RTSP ainda não conectou";
}

export function CameraTile({ camera }: { camera: Camera }) {
  const [showStatus, setShowStatus] = useState(false);
  // Always polled (not just when the "diagnóstico" panel is open) so the
  // status dot reflects real RTSP readiness, not just camera.status.
  const streamStatus = useCameraStreamStatus(camera.id, camera.status !== "offline");
  const isFlashing = useCameraEventStore((s) => s.flashingCameraIds.has(camera.id));
  const isPtzTarget = usePtzTargetStore((s) => s.target?.id === camera.id);
  const togglePtzTarget = usePtzTargetStore((s) => s.toggleTarget);

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-neutral-900 transition-shadow ${
        isPtzTarget
          ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.5)]"
          : isFlashing
            ? "border-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.5)]"
            : "border-neutral-800"
      }`}
    >
      <div className="relative aspect-video bg-black text-neutral-600">
        {camera.status === "offline" ? (
          <div className="flex h-full w-full items-center justify-center text-sm">Câmera offline</div>
        ) : (
          <HlsPlayer src={`/hls/${camera.id}/index.m3u8`} className="h-full w-full" />
        )}
        {camera.status !== "offline" && camera.recordingMode === "continuous" && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs font-medium text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Gravando
          </div>
        )}
        {camera.status !== "offline" && camera.recordingMode === "motion" && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs font-medium text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Gravação por movimento
          </div>
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
    </div>
  );
}
