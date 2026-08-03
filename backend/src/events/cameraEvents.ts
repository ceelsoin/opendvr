import type { Camera } from "../types/camera.js";
import { insertEvent, updateEventSnapshot, updateEventCaption, appendEventPipelineOutput, updateEventClipAnnotated } from "../db/events.repository.js";
import { emitEvent } from "../ws/index.js";
import { captureSnapshot } from "../onvif/snapshot.js";
import { captureFrameSnapshot } from "../media/frameSnapshot.js";
import { captureEventClip } from "../media/eventClip.js";
import { uploadSnapshotToS3 } from "../lib/s3Storage.js";
import { saveEventSnapshot, saveEventClip } from "../lib/snapshotStorage.js";
import { notifyEvent } from "../notifications/webhooks.js";
import { captionImage } from "../notifications/captioning.js";
import { triggerMotionRecording } from "../media/motionRecording.js";
import { getBaselineSnapshot } from "../media/baselineSnapshot.js";
import { getFrame } from "../media/frameCache.js";
import { clearTracks } from "../media/objectTracker.js";
import { drawDetections } from "../media/snapshotRenderer.js";
import { drawDetectionsOnClip } from "../media/clipRenderer.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { ClassifiedMotion } from "../media/objectDetection.js";

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

/** Heuristic for "this event is a real motion/tamper/intrusion alert" vs. a routine status event. Also matches this app's own object-detection topics ("object:person"/"object:vehicle"/"object:animal"/"object:other", see media/objectDetection.ts), which are always notable by construction (they only ever get emitted after a motion trigger already fired). */
const NOTABLE_TOPIC_PATTERN = /motion|tamper|linedetector|fielddetector|occupancy|intrusion|^object:/i;
export function isNotableEventTopic(topic: string): boolean {
  return NOTABLE_TOPIC_PATTERN.test(topic);
}

interface PipelineInfo {
  pipelines: string[];
  pipelineOutputs: Record<string, unknown>;
}

/**
 * Determines which detection pipeline(s) actually produced this event and
 * captures each one's raw output, purely from the topic string + message
 * shape already available at the call site - no new plumbing needed from
 * onvif/events.ts or media/objectDetection.ts. "object:*" topics only ever
 * come from media/objectDetection.ts's classifyMotionFrame (see that file),
 * which itself is only ever invoked after the video motion pipeline
 * (media/motionDetector.ts) triggers - so both are always tagged together,
 * plus "face_recognition" when a person's face was matched. Plain
 * "video:motion" is the video pipeline's own fallback when object
 * detection is disabled/unavailable. Anything else is a raw ONVIF
 * PullPoint topic (see onvif/events.ts).
 */
function buildPipelineInfo(topic: string, message: unknown): PipelineInfo {
  const pipelines: string[] = [];
  const pipelineOutputs: Record<string, unknown> = {};

  if (topic.startsWith("object:")) {
    const meta = message as { areaRatio?: unknown; category?: unknown; objects?: unknown; faces?: unknown } | null;
    pipelines.push("video_motion", "object_detection");
    pipelineOutputs.video_motion = { areaRatio: meta?.areaRatio };
    pipelineOutputs.object_detection = { category: meta?.category, objects: meta?.objects };
    if (meta?.faces) {
      pipelines.push("face_recognition");
      pipelineOutputs.face_recognition = { faces: meta.faces };
    }
  } else if (topic === "video:motion") {
    pipelines.push("video_motion");
    pipelineOutputs.video_motion = { areaRatio: (message as { areaRatio?: unknown } | null)?.areaRatio };
  } else {
    pipelines.push("onvif_event");
    pipelineOutputs.onvif_event = message;
  }

  return { pipelines, pipelineOutputs };
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
  // A new session later is an independent sighting - don't let it inherit
  // this one's track IDs (see media/objectTracker.ts).
  clearTracks(cameraId);
}

/** Whether a notable event session is currently in progress for a camera - used by media/baselineSnapshot.ts to avoid refreshing the "idle" reference frame while something is actually happening. */
export function isEventSessionActive(cameraId: string): boolean {
  return activeSessions.has(cameraId);
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

  const occurredAt = new Date();
  const { pipelines, pipelineOutputs } = buildPipelineInfo(topic, message);
  const eventId = insertEvent({
    cameraId: camera.id,
    type: topic,
    occurredAt: occurredAt.toISOString(),
    metadata: message,
    pipelines,
    pipelineOutputs,
  });
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
    // Deliberately NOT using frameCache.ts here (unlike the zone-editor
    // snapshot endpoint) - an event snapshot must reflect this exact
    // moment, not a frame that could be up to several minutes stale.
    let snapshot = await captureSnapshot(camera);
    if (!snapshot) {
      snapshot = await captureFrameSnapshot(camera.id);
    }

    const category = topic.startsWith("object:") ? topic.slice("object:".length) : null;
    // Feeds the object-detection/face-recognition pipeline's own results
    // into the captioning prompt as context (see notifications/captioning.ts's
    // buildDetectionContextHint) - only ever available for "object:*" topics,
    // which is exactly when `message` has this shape (see
    // media/objectDetection.ts's classifyMotionFrame).
    const detections = topic.startsWith("object:") ? (message as ClassifiedMotion["metadata"] | null) : null;

    // Optionally draws bounding boxes onto a SEPARATE copy of the snapshot
    // (see media/snapshotRenderer.ts) - `snapshot` itself stays untouched,
    // since captioning (below) should analyze the actual scene, not one
    // with boxes drawn over it.
    let outputSnapshot = snapshot;
    let snapshotAnnotated = false;
    if (camera.annotateEventSnapshots && detections?.objects.length) {
      // Draw on the EXACT frame the boxes were computed from (cached by
      // motionDetector.ts at classification time), not the `snapshot`
      // above - that one is captured moments later via a separate ONVIF/
      // ffmpeg roundtrip, so the object can have moved by the time it
      // arrives, making the box visibly miss it. Falls back to `snapshot`
      // if the cached frame is missing or has since gone stale (e.g. this
      // pipeline got unusually delayed and a newer trigger already
      // overwrote it).
      const cachedFrame = getFrame(camera.id);
      const annotationBase =
        cachedFrame && Date.now() - cachedFrame.capturedAt <= 20_000 ? cachedFrame.buffer : snapshot;
      if (annotationBase) {
        try {
          outputSnapshot = await drawDetections(annotationBase, detections.objects);
          snapshotAnnotated = true;
        } catch (err) {
          logger.debug({ err, cameraId: camera.id, eventId }, "Failed to annotate event snapshot; using the original");
        }
      }
    }

    if (outputSnapshot) {
      const snapshotPath = await saveEventSnapshot(camera.id, eventId, outputSnapshot);
      updateEventSnapshot(eventId, snapshotPath, snapshotAnnotated);
    } else {
      logger.warn({ cameraId: camera.id, eventId }, "Failed to capture a snapshot for event (both ONVIF and ffmpeg fallback failed)");
    }

    // Public URL for the snapshot (uploaded to S3-compatible storage, see
    // lib/s3Storage.ts), when configured - preferred by Discord/Telegram/
    // generic-webhook over a raw multipart attachment (see those files).
    const snapshotUrl = outputSnapshot ? await uploadSnapshotToS3(camera.id, outputSnapshot) : null;

    // A clickable link back to the Timeline, sent instead of a snapshot
    // attachment when the camera is actually recording (continuous or
    // motion-triggered) - only meaningful with PUBLIC_BASE_URL configured.
    const recordingLink =
      env.publicBaseUrl && camera.recordingMode !== "off"
        ? `${env.publicBaseUrl}/web/timeline?camera=${camera.id}`
        : undefined;

    // Real footage of the event, straight from MediaMTX's own recording,
    // when the camera is recording at all - preferred over the snapshot as
    // the notification's attachment; the snapshot stays as the fallback
    // for channels/cases where no clip could be fetched (see
    // media/eventClip.ts and notifyEvent below). Fetched in parallel with
    // the optional VLM caption (item 4) below - both are independent,
    // possibly-slow network calls.
    const [clip, caption] = await Promise.all([
      captureEventClip(camera, occurredAt).catch((err) => {
        logger.warn({ err, cameraId: camera.id, eventId }, "Failed to fetch event clip");
        return null;
      }),
      category && snapshot ? captionImage(snapshot, category, detections, getBaselineSnapshot(camera.id)) : Promise.resolve(null),
    ]);
    if (caption) {
      updateEventCaption(eventId, caption);
      appendEventPipelineOutput(eventId, "captioning", caption);
    }

    await notifyEvent(camera, topic, outputSnapshot ?? undefined, recordingLink, snapshotUrl ?? undefined, clip ?? undefined, caption ?? undefined);

    // Fire-and-forget: a bbox-annotated copy of the clip is an extra
    // artifact for the Events page (see media/clipRenderer.ts) - never
    // delays/blocks the notification that was just sent above, and never
    // replaces the raw clip already attached to it.
    if (clip && camera.annotateEventSnapshots && detections?.objects.length) {
      drawDetectionsOnClip(clip, detections.objects)
        .then((annotatedClip) => {
          if (!annotatedClip) return undefined;
          return saveEventClip(camera.id, eventId, annotatedClip).then((clipPath) => updateEventClipAnnotated(eventId, clipPath));
        })
        .catch((err) => {
          logger.debug({ err, cameraId: camera.id, eventId }, "Failed to render annotated event clip");
        });
    }
  })().catch((err) => {
    logger.warn({ err, cameraId: camera.id }, "Failed to process event snapshot/notification");
  });
}
