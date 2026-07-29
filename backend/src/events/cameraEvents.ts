import type { Camera } from "../types/camera.js";
import { insertEvent, updateEventSnapshot } from "../db/events.repository.js";
import { emitEvent } from "../ws/index.js";
import { captureSnapshot } from "../onvif/snapshot.js";
import { captureFrameSnapshot } from "../media/frameSnapshot.js";
import { uploadSnapshotToS3 } from "../lib/s3Storage.js";
import { saveEventSnapshot } from "../lib/snapshotStorage.js";
import { notifyEvent } from "../notifications/webhooks.js";
import { triggerMotionRecording } from "../media/motionRecording.js";
import { env } from "../config/env.js";
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

/**
 * Session-based debounce for notable events: a sustained motion sequence
 * (e.g. someone walking through frame for 30s, or a busy scene triggering
 * OpenCV/ONVIF repeatedly every few seconds) is treated as ONE event/
 * notification, not one per underlying signal. A session stays "active"
 * (each new signal just extends it, silently, with no new DB row/
 * notification) as long as signals keep arriving within EVENT_END_GRACE_MS
 * of each other. Once no new signal arrives for that long, the session
 * "ends", and a further EVENT_COOLDOWN_MS must pass before a brand new
 * session (and its own DB row/notification) can start.
 *
 * This is deliberately separate from media/motionRecording.ts's own
 * cooldown (which keeps controlling MediaMTX's `record` flag on every
 * signal, unaffected by this) and from motion_worker.py's own 10s
 * per-process debounce (which just rate-limits how often Python emits
 * messages at all) - this is the layer that actually stops one continuous
 * motion sequence from becoming several separate events/notifications.
 */
const EVENT_END_GRACE_MS = 20_000;
const EVENT_COOLDOWN_MS = 30_000;

interface EventSession {
  endTimer: NodeJS.Timeout;
}

const activeSessions = new Map<string, EventSession>();
const cooldownUntil = new Map<string, number>();

function endSession(cameraId: string): void {
  activeSessions.delete(cameraId);
  cooldownUntil.set(cameraId, Date.now() + EVENT_COOLDOWN_MS);
}

export function recordCameraEvent(camera: Camera, topic: string, message: unknown): void {
  const notable = isNotableEventTopic(topic);

  if (notable) {
    const existing = activeSessions.get(camera.id);
    if (existing) {
      // Same event still in progress - just extend it. No new DB row, no
      // new notification (that's the whole point), but motion-recording
      // still gets refreshed so the clip keeps extending while it lasts.
      clearTimeout(existing.endTimer);
      existing.endTimer = setTimeout(() => endSession(camera.id), EVENT_END_GRACE_MS).unref();
      if (camera.recordingMode === "motion") {
        triggerMotionRecording(camera.id);
      }
      return;
    }

    const cooldownEnd = cooldownUntil.get(camera.id);
    if (cooldownEnd && Date.now() < cooldownEnd) {
      // Still cooling down after the previous event ended - suppress
      // entirely, including motion-recording (a real new event will be
      // recorded once the cooldown lifts).
      return;
    }
  }

  const eventId = insertEvent({ cameraId: camera.id, type: topic, metadata: message });
  emitEvent(camera.id, topic, { metadata: message, eventId });

  if (!notable) {
    return;
  }

  if (camera.recordingMode === "motion") {
    triggerMotionRecording(camera.id);
  }

  activeSessions.set(camera.id, {
    endTimer: setTimeout(() => endSession(camera.id), EVENT_END_GRACE_MS).unref(),
  });

  // Best-effort snapshot capture + external webhook notification. Tries
  // the camera's own ONVIF GetSnapshotUri first (works even on cameras
  // whose Events service is broken - only the Events/PullPoint namespace
  // was found to hang up, Media commands work fine), falling back to
  // grabbing a single frame via ffmpeg directly from MediaMTX's
  // already-connected RTSP feed when ONVIF has no snapshot support at all
  // (common on the same cheap OEM cameras that need video-based motion
  // detection in the first place). Runs fire-and-forget so a slow/failing
  // camera HTTP snapshot endpoint or webhook never blocks the caller
  // (ONVIF pull loop or video frame-diff loop).
  void (async () => {
    let snapshot = await captureSnapshot(camera);
    if (!snapshot) {
      snapshot = await captureFrameSnapshot(camera.id);
    }
    if (snapshot) {
      const snapshotPath = await saveEventSnapshot(camera.id, eventId, snapshot);
      updateEventSnapshot(eventId, snapshotPath);
    } else {
      logger.warn({ cameraId: camera.id, eventId }, "Failed to capture a snapshot for event (both ONVIF and ffmpeg fallback failed)");
    }

    // Public URL for the snapshot (uploaded to S3-compatible storage, see
    // lib/s3Storage.ts), when configured - preferred by Discord/Telegram/
    // generic-webhook over a raw multipart attachment (see those files).
    const snapshotUrl = snapshot ? await uploadSnapshotToS3(camera.id, snapshot) : null;

    // A clickable link back to the Timeline, sent instead of a snapshot
    // attachment when the camera is actually recording (continuous or
    // motion-triggered) - only meaningful with PUBLIC_BASE_URL configured.
    const recordingLink =
      env.publicBaseUrl && camera.recordingMode !== "off"
        ? `${env.publicBaseUrl}/web/timeline?camera=${camera.id}`
        : undefined;

    await notifyEvent(camera, topic, snapshot ?? undefined, recordingLink, snapshotUrl ?? undefined);
  })().catch((err) => {
    logger.warn({ err, cameraId: camera.id }, "Failed to process event snapshot/notification");
  });
}
