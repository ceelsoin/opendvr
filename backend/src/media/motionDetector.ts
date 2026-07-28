import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { env } from "../config/env.js";
import type { Camera } from "../types/camera.js";
import { recordCameraEvent } from "../events/cameraEvents.js";
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
}

export function isDetectingMotion(cameraId: string): boolean {
  return detectors.has(cameraId);
}

export function startMotionDetector(camera: Camera): void {
  if (detectors.has(camera.id)) {
    return;
  }

  const rtspUrl = `${env.mediamtxRtspUrl}/${camera.id}`;
  const child = spawn("python3", [WORKER_SCRIPT_PATH, rtspUrl], { stdio: ["ignore", "pipe", "pipe"] });
  const handle: MotionDetectorHandle = { process: child, stopping: false };
  detectors.set(camera.id, handle);

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let parsed: MotionWorkerEvent;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed.type === "motion") {
      recordCameraEvent(camera, "video:motion", { areaRatio: parsed.areaRatio });
    }
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
