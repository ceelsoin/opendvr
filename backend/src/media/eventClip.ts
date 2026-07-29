import type { Camera } from "../types/camera.js";
import { getRecordingClip } from "./mediamtx.js";
import { logger } from "../lib/logger.js";

/** How much of the recording to grab, starting at the event's `occurredAt`. */
export const EVENT_CLIP_DURATION_SECONDS = 8;

/** Extra time to wait, past the clip's natural end, before asking MediaMTX for it - gives it a moment to flush the fMP4 parts covering that range to disk. */
const FETCH_BUFFER_MS = 3_000;

/** One retry, in case the first attempt landed just before MediaMTX finished flushing. */
const RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort fetch of an `EVENT_CLIP_DURATION_SECONDS`-long MP4 clip
 * starting at `occurredAt`, straight from MediaMTX's native recording (see
 * media/mediamtx.ts's `getRecordingClip`) - used by events/cameraEvents.ts
 * so external notifications (Discord/Telegram/webhook/email) can attach
 * the actual moment of the event instead of just a single snapshot frame.
 *
 * Only meaningful when the camera is actually recording (continuous, or
 * motion-triggered - which events/cameraEvents.ts already turns on before
 * calling this); returns `null` otherwise, and on any failure, so callers
 * can fall back to a snapshot.
 */
export async function captureEventClip(camera: Pick<Camera, "id" | "recordingMode">, occurredAt: Date): Promise<Buffer | null> {
  if (camera.recordingMode === "off") {
    return null;
  }

  const readyAt = occurredAt.getTime() + EVENT_CLIP_DURATION_SECONDS * 1000 + FETCH_BUFFER_MS;
  const initialWaitMs = readyAt - Date.now();
  if (initialWaitMs > 0) {
    await sleep(initialWaitMs);
  }

  const start = occurredAt.toISOString();
  try {
    const clip = await getRecordingClip(camera.id, start, EVENT_CLIP_DURATION_SECONDS);
    if (clip) return clip;
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to fetch event clip (first attempt)");
  }

  // Give MediaMTX a bit more time and try once more before giving up.
  await sleep(RETRY_DELAY_MS);
  try {
    return await getRecordingClip(camera.id, start, EVENT_CLIP_DURATION_SECONDS);
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to fetch event clip (retry)");
    return null;
  }
}
