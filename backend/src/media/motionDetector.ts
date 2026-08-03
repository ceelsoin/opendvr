import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { env } from "../config/env.js";
import type { Camera } from "../types/camera.js";
import { recordCameraEvent } from "../events/cameraEvents.js";
import { classifyMotionFrame } from "./objectDetection.js";
import { setFrame } from "./frameCache.js";
import { emitDetections } from "../ws/index.js";
import { logger } from "../lib/logger.js";

/**
 * Manages one `motion_worker.py` (OpenCV MOG2 background subtraction, see
 * that file) child process per camera with `motionDetectionSource ===
 * "video"`, reading MediaMTX's already-connected RTSP feed (so no extra
 * connection to the physical camera is made - important for cameras that
 * only tolerate one or two concurrent sessions, as documented elsewhere in
 * this codebase).
 *
 * Same respawn-on-crash pattern as media/vlcRelay.ts: tracks a `stopping`
 * flag to distinguish an intentional stop from an unexpected exit.
 */

const RESPAWN_DELAY_MS = 5000;
const WORKER_SCRIPT_PATH = path.join(process.cwd(), "motion_worker.py");

interface MotionDetectorHandle {
  process: ChildProcess;
  stopping: boolean;
}

const detectors = new Map<string, MotionDetectorHandle>();

interface MotionWorkerEvent {
  type: string;
  areaRatio?: number;
  /** Normalized [x, y, w, h] union bbox of the motion contours, used by objectTracker.ts to cheaply match against existing tracks - see motion_worker.py. */
  box?: [number, number, number, number];
  /** Base64 JPEG of the triggering frame, used for object detection - see objectDetection.ts. */
  frame?: string;
}

export function isDetectingMotion(cameraId: string): boolean {
  return detectors.has(cameraId);
}

export function startMotionDetector(camera: Camera): void {
  if (detectors.has(camera.id)) {
    return;
  }

  const rtspUrl = `${env.mediamtxRtspUrl}/${camera.id}`;
  // Zone of interest (item 2) is passed straight through as a CLI arg so
  // plain MOG2 motion detection itself respects it too, not just the
  // downstream object/face detection layer (see objectDetection.ts) - the
  // zone only ever changes via a camera edit, which already restarts this
  // process (see cameras.routes.ts's PATCH handler), so a fresh spawn here
  // always picks up the current value.
  const zoneArg = camera.detectionZone ? JSON.stringify(camera.detectionZone) : "";
  const child = spawn("python3", [WORKER_SCRIPT_PATH, rtspUrl, zoneArg], { stdio: ["ignore", "pipe", "pipe"] });
  const handle: MotionDetectorHandle = { process: child, stopping: false };
  detectors.set(camera.id, handle);

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let parsed: MotionWorkerEvent;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed.type !== "motion") {
      return;
    }

    // Object detection (item 1) is opt-in per camera and only ever kicks
    // in on frames that already triggered MOG2 above - it never runs on
    // every frame, keeping CPU cost bounded (see media/objectDetection.ts).
    if (camera.objectDetectionEnabled && parsed.frame) {
      const frameBuffer = Buffer.from(parsed.frame, "base64");
      // Free reuse: this same buffer is already in memory, so share it via
      // frameCache.ts for other callers (zone editor, baseline refresh)
      // instead of them spawning their own ffmpeg capture - see plans/01-frame-cache.md.
      setFrame(camera.id, frameBuffer, "motion");
      void classifyMotionFrame(camera, frameBuffer, parsed.areaRatio ?? 0, parsed.box)
        .then((classified) => {
          if (classified) {
            // Broadcast on EVERY classification (not just the first one of
            // a debounced event session, see events/cameraEvents.ts) - the
            // live-view overlay should refresh for as long as something is
            // being tracked, independent of the DB/notification debounce.
            emitDetections(camera.id, classified.metadata.objects);
            recordCameraEvent(camera, classified.topic, classified.metadata);
          }
          // classified === null means either the feature is unavailable
          // (model missing/worker down - fall back to the plain signal
          // below) or detection ran but found nothing relevant after zone
          // filtering (a real false positive - suppress entirely, do NOT
          // fall back to the generic "video:motion" event in that case).
        })
        .catch((err) => {
          logger.debug({ err, cameraId: camera.id }, "Object detection failed; falling back to plain motion event");
          recordCameraEvent(camera, "video:motion", { areaRatio: parsed.areaRatio });
        });
      return;
    }

    recordCameraEvent(camera, "video:motion", { areaRatio: parsed.areaRatio });
  });

  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    logger.debug({ cameraId: camera.id, line }, "motion_worker.py");
  });

  child.on("error", (err) => {
    logger.warn({ err, cameraId: camera.id }, "Failed to start video motion detector process");
  });

  child.on("exit", (code, signal) => {
    detectors.delete(camera.id);
    if (!handle.stopping) {
      logger.warn(
        { cameraId: camera.id, code, signal },
        "Video motion detector process exited unexpectedly; respawning"
      );
      setTimeout(() => startMotionDetector(camera), RESPAWN_DELAY_MS).unref();
    }
  });

  logger.info({ cameraId: camera.id }, "Started video-based motion detector");
}

export function stopMotionDetector(cameraId: string): void {
  const handle = detectors.get(cameraId);
  if (!handle) {
    return;
  }
  handle.stopping = true;
  detectors.delete(cameraId);
  handle.process.kill();
  logger.info({ cameraId }, "Stopped video-based motion detector");
}

export function stopAllMotionDetectors(): void {
  for (const cameraId of [...detectors.keys()]) {
    stopMotionDetector(cameraId);
  }
}

export interface MotionDetectorStatus {
  cameraId: string;
  running: boolean;
  pid: number | null;
}

/** Snapshot of every currently-tracked motion_worker.py process, for the Dashboard's process-health view. */
export function listMotionDetectorStatuses(): MotionDetectorStatus[] {
  return [...detectors.entries()].map(([cameraId, handle]) => ({
    cameraId,
    running: handle.process.exitCode === null && !handle.process.killed,
    pid: handle.process.pid ?? null,
  }));
}
