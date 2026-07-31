import { listCameras } from "../db/cameras.repository.js";
import { listGrids } from "../db/grids.repository.js";
import { checkMediaMtxHealth, type MediaMtxHealth } from "../media/mediamtx.js";
import { listVlcRelayStatuses } from "../media/vlcRelay.js";
import { listRotationBridgeStatuses } from "../media/rotationBridge.js";
import { listTimestampBridgeStatuses } from "../media/timestampBridge.js";
import { listMjpegBridgeStatuses } from "../media/mjpegBridge.js";
import { listWebpageBridgeStatuses, isSharedBrowserRunning } from "../media/webpageBridge.js";
import { listMotionDetectorStatuses } from "../media/motionDetector.js";
import { getVisionWorkerStatus, type VisionWorkerStatus } from "../media/visionWorker.js";
import { listGridBroadcastStatuses, type GridBroadcastStatus } from "../media/gridBroadcastBridge.js";
import { getCaptioningHealth, type CaptioningHealth } from "../notifications/captioning.js";

export type TranscodeBridgeKind = "rotation" | "timestamp" | "mjpeg" | "webpage";

export interface TranscodeBridgeStatus {
  kind: TranscodeBridgeKind;
  running: boolean;
  pid: number | null;
}

export interface CameraProcessStatus {
  id: string;
  name: string;
  sourceType: string;
  /** VLC RTSP-compatibility relay (rtspCompatMode "vlc-relay") - see media/vlcRelay.ts. */
  vlcRelay: { running: boolean; pid: number | null; port: number } | null;
  /** Whichever single ffmpeg pipeline (at most one per camera) is currently feeding this camera's MediaMTX path. */
  transcodeBridge: TranscodeBridgeStatus | null;
  /** Local OpenCV motion_worker.py process (motionDetectionSource "video") - see media/motionDetector.ts. */
  motionWorker: { running: boolean; pid: number | null } | null;
}

export interface GridBroadcastProcessStatus extends GridBroadcastStatus {
  name: string;
}

export interface ProcessHealth {
  mediamtx: MediaMtxHealth;
  captioning: CaptioningHealth;
  visionWorker: VisionWorkerStatus;
  /** Single shared headless Chromium instance backing every "webpage" source camera - see media/webpageBridge.ts. */
  webpageBrowserRunning: boolean;
  cameras: CameraProcessStatus[];
  gridBroadcasts: GridBroadcastProcessStatus[];
}

/**
 * Aggregates process/health info from every media pipeline this backend
 * manages (VLC relay, ffmpeg transcode/timestamp/mjpeg/webpage bridges,
 * motion detectors, the shared vision worker, grid broadcasts) plus
 * external services it depends on (MediaMTX, the configured captioning
 * provider) - for the Dashboard's process-health view (item: "não consigo
 * saber nada" about what's actually running). Read-only, never throws as a
 * whole (individual health checks already swallow their own errors).
 */
export async function getProcessHealth(): Promise<ProcessHealth> {
  const [mediamtx, captioning] = await Promise.all([checkMediaMtxHealth(), getCaptioningHealth()]);

  const vlcRelays = new Map(listVlcRelayStatuses().map((s) => [s.cameraId, s]));
  const rotationBridges = new Map(listRotationBridgeStatuses().map((s) => [s.cameraId, s]));
  const timestampBridges = new Map(listTimestampBridgeStatuses().map((s) => [s.cameraId, s]));
  const mjpegBridges = new Map(listMjpegBridgeStatuses().map((s) => [s.cameraId, s]));
  const webpageBridges = new Map(listWebpageBridgeStatuses().map((s) => [s.cameraId, s]));
  const motionWorkers = new Map(listMotionDetectorStatuses().map((s) => [s.cameraId, s]));

  const cameras: CameraProcessStatus[] = listCameras().map((camera) => {
    const rotation = rotationBridges.get(camera.id);
    const timestamp = timestampBridges.get(camera.id);
    const mjpeg = mjpegBridges.get(camera.id);
    const webpage = webpageBridges.get(camera.id);
    // At most one of these is ever active for a given camera (see
    // media/provisioning.ts) - first match wins, order doesn't matter.
    const transcodeBridge: TranscodeBridgeStatus | null = rotation
      ? { kind: "rotation", running: rotation.running, pid: rotation.pid }
      : timestamp
        ? { kind: "timestamp", running: timestamp.running, pid: timestamp.pid }
        : mjpeg
          ? { kind: "mjpeg", running: mjpeg.running, pid: mjpeg.pid }
          : webpage
            ? { kind: "webpage", running: webpage.running, pid: webpage.pid }
            : null;

    const relay = vlcRelays.get(camera.id);
    const motion = motionWorkers.get(camera.id);

    return {
      id: camera.id,
      name: camera.name,
      sourceType: camera.sourceType,
      vlcRelay: relay ? { running: relay.running, pid: relay.pid, port: relay.port } : null,
      transcodeBridge,
      motionWorker: motion ? { running: motion.running, pid: motion.pid } : null,
    };
  });

  const gridsById = new Map(listGrids().map((g) => [g.id, g]));
  const gridBroadcasts: GridBroadcastProcessStatus[] = listGridBroadcastStatuses().map((status) => ({
    ...status,
    name: gridsById.get(status.gridId)?.name ?? status.gridId,
  }));

  return {
    mediamtx,
    captioning,
    visionWorker: getVisionWorkerStatus(),
    webpageBrowserRunning: isSharedBrowserRunning(),
    cameras,
    gridBroadcasts,
  };
}
