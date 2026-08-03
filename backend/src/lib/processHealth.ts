import { listCameras } from "../db/cameras.repository.js";
import { listGrids } from "../db/grids.repository.js";
import { checkMediaMtxHealth, type MediaMtxHealth } from "../media/mediamtx.js";
import { listVlcRelayStatuses } from "../media/vlcRelay.js";
import { listRotationBridgeStatuses } from "../media/rotationBridge.js";
import { listTimestampBridgeStatuses } from "../media/timestampBridge.js";
import { listMjpegBridgeStatuses } from "../media/mjpegBridge.js";
import { listWebpageBridgeStatuses, isSharedBrowserRunning } from "../media/webpageBridge.js";
import { listMotionDetectorStatuses } from "../media/motionDetector.js";
import { getVisionWorkerStatus, getModelStatus, type VisionWorkerStatus, type VisionModelStatus } from "../media/visionWorker.js";
import { listGridBroadcastStatuses, type GridBroadcastStatus } from "../media/gridBroadcastBridge.js";
import { getCaptioningHealth, type CaptioningHealth } from "../notifications/captioning.js";
import { getStats as getFrameCacheStats, type FrameCacheStats } from "../media/frameCache.js";

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
  /**
   * `enabled` mirrors the DB flag (`camera.objectDetectionEnabled`); `active`
   * additionally requires `motionDetectionSource === "video"` - object
   * detection is ONLY ever invoked from the video-based motion pipeline
   * (media/objectDetection.ts's classifyMotionFrame, called from
   * motionDetector.ts), never from ONVIF PullPoint events. A camera can
   * have `enabled: true, active: false` if it was configured for object
   * detection while using "video", then switched to ONVIF-based motion
   * detection afterwards - the flag stays set in the DB but the feature
   * silently stops firing, which is exactly the confusing case this field
   * exists to surface.
   */
  objectDetection: { enabled: boolean; active: boolean } | null;
  /** Same `enabled`/`active` distinction as objectDetection - face recognition additionally only ever runs after a "person" object detection already fired. */
  faceRecognition: { enabled: boolean; active: boolean } | null;
}

export interface GridBroadcastProcessStatus extends GridBroadcastStatus {
  name: string;
}

export interface ProcessHealth {
  mediamtx: MediaMtxHealth;
  captioning: CaptioningHealth;
  visionWorker: VisionWorkerStatus;
  /** Whether each AI model file actually loaded on the shared vision worker - null entries mean the worker wasn't running/didn't respond in time, not necessarily that the model is missing. */
  visionModels: { yolo: boolean | null; faceDetect: boolean | null; faceRecognize: boolean | null };
  /** In-memory per-camera latest-frame cache - see media/frameCache.ts (plans/01-frame-cache.md). */
  frameCache: FrameCacheStats;
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
  const [mediamtx, captioning, visionModels] = await Promise.all([
    checkMediaMtxHealth(),
    getCaptioningHealth(),
    getModelStatus().catch(() => null),
  ]);

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
    const motionSourceIsVideo = camera.motionDetectionSource === "video";

    return {
      id: camera.id,
      name: camera.name,
      sourceType: camera.sourceType,
      vlcRelay: relay ? { running: relay.running, pid: relay.pid, port: relay.port } : null,
      transcodeBridge,
      motionWorker: motion ? { running: motion.running, pid: motion.pid } : null,
      objectDetection: camera.objectDetectionEnabled
        ? { enabled: true, active: motionSourceIsVideo }
        : null,
      faceRecognition: camera.faceRecognitionEnabled
        ? { enabled: true, active: motionSourceIsVideo }
        : null,
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
    visionModels: {
      yolo: visionModels?.yolo ?? null,
      faceDetect: visionModels?.faceDetect ?? null,
      faceRecognize: visionModels?.faceRecognize ?? null,
    },
    webpageBrowserRunning: isSharedBrowserRunning(),
    frameCache: getFrameCacheStats(),
    cameras,
    gridBroadcasts,
  };
}
