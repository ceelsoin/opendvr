import { patchCameraPath } from "./mediamtx.js";
import { logger } from "../lib/logger.js";

/**
 * Reactive "record on motion" behavior for cameras with `recordingMode ===
 * "motion"`: MediaMTX's own recording toggle (the `record` field on a path)
 * is static, so this keeps per-camera in-memory timers that flip it on when
 * a motion-ish ONVIF event fires, and back off again after a cooldown
 * window with no further events - similar to Agent DVR/iSpy's "record for
 * N seconds after motion" behavior, with the cooldown acting as a
 * post-record buffer so brief pauses in motion don't chop a single event
 * into many tiny clips.
 */
const COOLDOWN_MS = 60_000;

interface MotionRecordingState {
  recording: boolean;
  cooldownTimer: NodeJS.Timeout;
}

const state = new Map<string, MotionRecordingState>();

export function triggerMotionRecording(cameraId: string): void {
  const existing = state.get(cameraId);
  if (existing) {
    clearTimeout(existing.cooldownTimer);
  } else {
    void patchCameraPath(cameraId, { record: true }).catch((err) => {
      logger.warn({ err, cameraId }, "Failed to start motion-triggered recording");
    });
  }

  const cooldownTimer = setTimeout(() => {
    state.delete(cameraId);
    void patchCameraPath(cameraId, { record: false }).catch((err) => {
      logger.warn({ err, cameraId }, "Failed to stop motion-triggered recording");
    });
  }, COOLDOWN_MS);
  cooldownTimer.unref();

  state.set(cameraId, { recording: true, cooldownTimer });
}

/** Cancels any pending motion-recording cooldown, e.g. when a camera is deleted or its mode changes. */
export function stopMotionRecording(cameraId: string): void {
  const existing = state.get(cameraId);
  if (!existing) {
    return;
  }
  clearTimeout(existing.cooldownTimer);
  state.delete(cameraId);
  void patchCameraPath(cameraId, { record: false }).catch((err) => {
    logger.warn({ err, cameraId }, "Failed to stop motion-triggered recording");
  });
}
