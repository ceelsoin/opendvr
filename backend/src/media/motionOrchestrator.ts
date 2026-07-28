import type { Camera } from "../types/camera.js";
import { startEventListener, stopEventListener, shouldListenForEvents } from "../onvif/events.js";
import { startMotionDetector, stopMotionDetector } from "./motionDetector.js";

/**
 * Picks which motion-signal source to run for a camera: ONVIF PullPoint
 * events (onvif/events.ts) or local video analysis (media/motionDetector.ts,
 * OpenCV-based). Both funnel into the same shared pipeline (see
 * events/cameraEvents.ts) once a motion signal fires, so the rest of the
 * app (DB, WebSocket/toast/green-flash, snapshot, webhooks, motion
 * recording) doesn't need to know which source produced it.
 */

export function shouldDetectMotion(camera: Pick<Camera, "motionRecording" | "recordingMode">): boolean {
  return shouldListenForEvents(camera);
}

export async function startMotionListening(camera: Camera): Promise<void> {
  if (!shouldDetectMotion(camera)) {
    return;
  }
  if (camera.motionDetectionSource === "video") {
    startMotionDetector(camera);
  } else {
    await startEventListener(camera);
  }
}

/** Stops both sources unconditionally (idempotent) - important when switching source, since the previously-active one needs to be torn down regardless of the camera's current setting. */
export function stopMotionListening(cameraId: string): void {
  stopEventListener(cameraId);
  stopMotionDetector(cameraId);
}

export async function restartMotionListening(camera: Camera): Promise<void> {
  stopMotionListening(camera.id);
  await startMotionListening(camera);
}
