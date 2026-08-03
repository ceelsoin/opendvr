import { captureFrameSnapshot } from "./frameSnapshot.js";

/**
 * In-memory cache of the most recent JPEG frame per camera, so callers that
 * only need "a reasonably fresh frame" (not necessarily the exact current
 * instant) can skip spawning a new ffmpeg process - see plans/01-frame-cache.md.
 * Fed passively by motionDetector.ts (the frame motion_worker.py already
 * sends on every trigger) and baselineSnapshot.ts (its periodic idle-frame
 * poll), at no extra capture cost.
 */

type FrameSource = "motion" | "poll";

interface CachedFrame {
  buffer: Buffer;
  capturedAt: number;
  source: FrameSource;
}

const frames = new Map<string, CachedFrame>();

/** Records a frame that was already captured elsewhere (no I/O here). */
export function setFrame(cameraId: string, buffer: Buffer, source: FrameSource): void {
  frames.set(cameraId, { buffer, capturedAt: Date.now(), source });
}

/** Returns the cached frame for a camera regardless of age, or null if none exists yet. */
export function getFrame(cameraId: string): CachedFrame | null {
  return frames.get(cameraId) ?? null;
}

export function removeFrame(cameraId: string): void {
  frames.delete(cameraId);
}

export interface FrameCacheStats {
  cachedCameras: number;
  /** Average age (ms) of every currently cached frame, or null if the cache is empty - see lib/processHealth.ts (Dashboard). */
  averageAgeMs: number | null;
}

export function getStats(): FrameCacheStats {
  if (frames.size === 0) {
    return { cachedCameras: 0, averageAgeMs: null };
  }
  const now = Date.now();
  let totalAge = 0;
  for (const frame of frames.values()) {
    totalAge += now - frame.capturedAt;
  }
  return { cachedCameras: frames.size, averageAgeMs: Math.round(totalAge / frames.size) };
}

/**
 * Returns a frame no older than `maxAgeMs` if the cache has one; otherwise
 * falls back to a fresh ffmpeg capture (and caches that result too).
 */
export async function getRecentFrame(cameraId: string, maxAgeMs: number): Promise<Buffer | null> {
  const cached = frames.get(cameraId);
  if (cached && Date.now() - cached.capturedAt <= maxAgeMs) {
    return cached.buffer;
  }
  const fresh = await captureFrameSnapshot(cameraId);
  if (fresh) {
    setFrame(cameraId, fresh, "poll");
  }
  return fresh;
}
