import { captureFrameSnapshot } from "./frameSnapshot.js";
import { listCameras } from "../db/cameras.repository.js";
import { isEventSessionActive } from "../events/cameraEvents.js";
import { logger } from "../lib/logger.js";

/**
 * Keeps one cached "idle" (no-motion) reference frame per camera, refreshed
 * periodically - used by notifications/captioning.ts to describe what
 * actually CHANGED relative to the camera's normal/empty view ("a car is
 * now parked in the driveway that wasn't there before") instead of just
 * describing the event frame in isolation. Only maintained for cameras
 * with object detection enabled, the only feature that currently consumes it.
 */

// Frequent enough to track scene/lighting drift over the day, rare enough
// to be cheap (one extra ffmpeg frame-grab per camera per tick).
const REFRESH_INTERVAL_MS = 10 * 60_000;

const baselines = new Map<string, Buffer>();

/** Returns the cached idle-frame snapshot for a camera, or null if none has been captured yet. */
export function getBaselineSnapshot(cameraId: string): Buffer | null {
  return baselines.get(cameraId) ?? null;
}

export function removeBaselineSnapshot(cameraId: string): void {
  baselines.delete(cameraId);
}

async function refreshCamera(cameraId: string): Promise<void> {
  // Skip entirely while a motion/event session is in progress (see
  // events/cameraEvents.ts) - refreshing mid-event would bake the moving
  // subject into the "empty scene" baseline, defeating the whole point.
  if (isEventSessionActive(cameraId)) return;
  try {
    const snapshot = await captureFrameSnapshot(cameraId);
    if (snapshot) {
      baselines.set(cameraId, snapshot);
    }
  } catch (err) {
    logger.debug({ err, cameraId }, "Failed to refresh idle baseline snapshot");
  }
}

function refreshAll(): void {
  for (const camera of listCameras()) {
    if (!camera.enabled || !camera.objectDetectionEnabled) continue;
    void refreshCamera(camera.id);
  }
}

let started = false;

/** Starts the periodic baseline-refresh loop (idempotent) - called once at boot, see index.ts. */
export function startBaselineSnapshotRefresh(): void {
  if (started) return;
  started = true;
  refreshAll(); // seed immediately, don't wait a full interval for the first baseline
  setInterval(refreshAll, REFRESH_INTERVAL_MS).unref();
}
