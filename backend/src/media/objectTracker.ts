import type { ObjectDetection } from "./visionWorker.js";

/**
 * Association-based object tracker, scoped per camera - see
 * plans/02-tracking-de-objetos.md. Deliberately NOT ByteTrack/DeepSORT/
 * MOSSE/KCF (no new dependency, no opencv-contrib): detections are matched
 * to existing tracks by a simple weighted score (IoU + center proximity +
 * size similarity), picked greedily per detection (no Hungarian Algorithm -
 * unnecessary at the handful-of-objects-per-camera scale this app deals
 * with). Lives in Node, not vision_worker.py, because the natural scope for
 * track state (one camera's current event session) already lives here -
 * see events/cameraEvents.ts's `activeSessions`.
 */

type Box = [number, number, number, number];

export interface Track {
  id: number;
  category: ObjectDetection["category"];
  label: string;
  confidence: number;
  box: Box;
  firstSeenAt: number;
  lastSeenAt: number;
  framesSeen: number;
}

export interface DetectionWithTrack extends ObjectDetection {
  trackId: number;
  framesSeen: number;
  firstSeenAt: number;
}

interface CameraTrackState {
  tracks: Track[];
  /** Real YOLO calls made since the last skip streak - forces a periodic re-check so a track can't coast forever on a stale classification. */
  skippedSinceConfirm: number;
}

// A track not updated for this long is considered gone - roughly aligned
// with cameraEvents.ts's EVENT_END_GRACE_MS (a session-ending gap), so
// tracks naturally expire around the same time a session would end anyway.
const TRACK_TTL_MS = 20_000;
// Only reuse a track (skip a fresh YOLO call) if it was genuinely just
// confirmed - tighter than TRACK_TTL_MS on purpose, reuse should require a
// "we basically just saw this" track, not one about to expire anyway.
const REUSE_MAX_AGE_MS = 8_000;
// Weights cited directly in the design conversation: 0.6 IoU + 0.3 center
// proximity + 0.1 size similarity.
const IOU_WEIGHT = 0.6;
const CENTER_WEIGHT = 0.3;
const SIZE_WEIGHT = 0.1;
const MATCH_SCORE_THRESHOLD = 0.35;
// Force a real YOLO call at least this often even if a track keeps
// matching the motion bbox, so a track can't "forget" a real category
// change (e.g. someone sets down a bag) indefinitely.
const MAX_SKIPS_BEFORE_RECHECK = 4;
// Max possible normalized center-to-center distance is sqrt(2) (opposite
// corners of a unit square) - used to fold distance into a 0..1 score.
const MAX_CENTER_DISTANCE = Math.SQRT2;

const state = new Map<string, CameraTrackState>();
let nextTrackId = 1;

function boxArea([, , w, h]: Box): number {
  return Math.max(0, w) * Math.max(0, h);
}

function iou(a: Box, b: Box): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = boxArea(a) + boxArea(b) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function centerProximity(a: Box, b: Box): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const dx = ax + aw / 2 - (bx + bw / 2);
  const dy = ay + ah / 2 - (by + bh / 2);
  const distance = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, 1 - distance / MAX_CENTER_DISTANCE);
}

function sizeSimilarity(a: Box, b: Box): number {
  const areaA = boxArea(a);
  const areaB = boxArea(b);
  const largest = Math.max(areaA, areaB);
  return largest === 0 ? 1 : 1 - Math.abs(areaA - areaB) / largest;
}

function matchScore(a: Box, b: Box): number {
  return IOU_WEIGHT * iou(a, b) + CENTER_WEIGHT * centerProximity(a, b) + SIZE_WEIGHT * sizeSimilarity(a, b);
}

function getState(cameraId: string): CameraTrackState {
  let camState = state.get(cameraId);
  if (!camState) {
    camState = { tracks: [], skippedSinceConfirm: 0 };
    state.set(cameraId, camState);
  }
  return camState;
}

function toDetection(track: Track): DetectionWithTrack {
  return {
    label: track.label,
    category: track.category,
    confidence: track.confidence,
    box: track.box,
    trackId: track.id,
    framesSeen: track.framesSeen,
    firstSeenAt: track.firstSeenAt,
  };
}

/**
 * Cheap pre-YOLO check: if a recent, still-fresh track's box roughly
 * matches where MOG2 says motion just happened, reuse that track's last
 * known classification instead of paying for a new YOLO call. Returns null
 * whenever there's no confident match (including once
 * MAX_SKIPS_BEFORE_RECHECK has been hit), in which case the caller should
 * run real detection and call `updateTracks` with the result.
 */
export function tryReuseTrack(cameraId: string, motionBox: Box): DetectionWithTrack | null {
  const camState = getState(cameraId);
  if (camState.skippedSinceConfirm >= MAX_SKIPS_BEFORE_RECHECK) {
    return null;
  }
  const now = Date.now();
  let best: Track | null = null;
  let bestScore = 0;
  for (const track of camState.tracks) {
    if (now - track.lastSeenAt > REUSE_MAX_AGE_MS) continue;
    const score = matchScore(track.box, motionBox);
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }
  if (!best || bestScore < MATCH_SCORE_THRESHOLD) {
    return null;
  }
  best.box = motionBox;
  best.lastSeenAt = now;
  best.framesSeen += 1;
  camState.skippedSinceConfirm += 1;
  return toDetection(best);
}

/**
 * Associates a fresh batch of YOLO detections with existing tracks (same
 * category, best score above threshold, matched greedily by descending
 * detection confidence), creating new tracks for anything unmatched and
 * letting stale tracks simply age out via TRACK_TTL_MS. Resets the
 * skip-YOLO counter, since this IS the real confirmation.
 */
export function updateTracks(cameraId: string, detections: ObjectDetection[]): DetectionWithTrack[] {
  const camState = getState(cameraId);
  camState.skippedSinceConfirm = 0;

  const now = Date.now();
  camState.tracks = camState.tracks.filter((track) => now - track.lastSeenAt <= TRACK_TTL_MS);

  const available = new Set(camState.tracks);
  const results = new Array<DetectionWithTrack>(detections.length);
  const order = detections
    .map((detection, index) => ({ detection, index }))
    .sort((a, b) => b.detection.confidence - a.detection.confidence);

  for (const { detection, index } of order) {
    let best: Track | null = null;
    let bestScore = 0;
    for (const track of available) {
      if (track.category !== detection.category) continue;
      const score = matchScore(track.box, detection.box);
      if (score > bestScore) {
        bestScore = score;
        best = track;
      }
    }

    let track: Track;
    if (best && bestScore >= MATCH_SCORE_THRESHOLD) {
      best.box = detection.box;
      best.label = detection.label;
      best.confidence = detection.confidence;
      best.lastSeenAt = now;
      best.framesSeen += 1;
      track = best;
      available.delete(best);
    } else {
      track = {
        id: nextTrackId++,
        category: detection.category,
        label: detection.label,
        confidence: detection.confidence,
        box: detection.box,
        firstSeenAt: now,
        lastSeenAt: now,
        framesSeen: 1,
      };
      camState.tracks.push(track);
    }

    results[index] = toDetection(track);
  }

  return results;
}

/** Drops all tracking state for a camera - called when its event session ends (events/cameraEvents.ts) and on camera delete, so a new independent session/camera never inherits stale track IDs. */
export function clearTracks(cameraId: string): void {
  state.delete(cameraId);
}
