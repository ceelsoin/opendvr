import type { Camera } from "../types/camera.js";
import { insertEvent, updateEventSnapshot } from "../db/events.repository.js";
import { emitEvent } from "../ws/index.js";
import { captureSnapshot } from "../onvif/snapshot.js";
import { saveEventSnapshot } from "../lib/snapshotStorage.js";
import { notifyEvent } from "../notifications/webhooks.js";
import { triggerMotionRecording } from "../media/motionRecording.js";
import { logger } from "../lib/logger.js";

/**
 * Shared "a motion-ish event happened" pipeline, called from BOTH motion
 * signal sources this app supports:
 *  - ONVIF PullPoint notifications (see onvif/events.ts)
 *  - Local video analysis (see media/motionDetector.ts)
 *
 * Persists the event, broadcasts it over WebSocket (drives the frontend's
 * green flash + toast), and - only for "notable" topics - triggers
 * motion-recording and best-effort snapshot capture + external webhooks.
 */

/** Heuristic for "this event is a real motion/tamper/intrusion alert" vs. a routine status event. */
const NOTABLE_TOPIC_PATTERN = /motion|tamper|linedetector|fielddetector|occupancy|intrusion/i;
export function isNotableEventTopic(topic: string): boolean {
  return NOTABLE_TOPIC_PATTERN.test(topic);
}

export function recordCameraEvent(camera: Camera, topic: string, message: unknown): void {
  const eventId = insertEvent({ cameraId: camera.id, type: topic, metadata: message });
  emitEvent(camera.id, topic, { metadata: message, eventId });

  if (!isNotableEventTopic(topic)) {
    return;
  }

  if (camera.recordingMode === "motion") {
    triggerMotionRecording(camera.id);
  }

  // Best-effort snapshot capture (still via ONVIF's GetSnapshotUri, which is
  // unaffected even on cameras whose Events service is broken - only the
  // Events/PullPoint namespace was found to hang up, Media commands work
  // fine) + external webhook notification. Runs fire-and-forget so a
  // slow/failing camera HTTP snapshot endpoint or webhook never blocks the
  // caller (ONVIF pull loop or video frame-diff loop).
  void (async () => {
    const snapshot = await captureSnapshot(camera);
    if (snapshot) {
      const snapshotPath = await saveEventSnapshot(camera.id, eventId, snapshot);
      updateEventSnapshot(eventId, snapshotPath);
    }
    await notifyEvent(camera, topic, snapshot ?? undefined);
  })().catch((err) => {
    logger.warn({ err, cameraId: camera.id }, "Failed to process event snapshot/notification");
  });
}
