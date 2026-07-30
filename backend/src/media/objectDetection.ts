import type { Camera } from "../types/camera.js";
import { detectObjects, detectFaces, type ObjectDetection } from "./visionWorker.js";
import { pointInPolygon } from "../lib/geometry.js";
import { listFaces } from "../db/faces.repository.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Turns a raw OpenCV motion-detector trigger (media/motionDetector.ts) into
 * a classified "what actually moved" result, using the shared YOLO worker
 * (media/visionWorker.ts) - and, for a detected person, optional face
 * recognition against the known_faces table. This is the layer that
 * decides whether a motion blob is worth an event at all (item 1: object
 * detection) and whether it falls inside the camera's configured zone of
 * interest (item 2), before events/cameraEvents.ts's usual
 * session/notification pipeline takes over.
 *
 * Returns `null` when object detection isn't usable (feature disabled,
 * model missing, or the request failed) - callers fall back to the
 * original plain "video:motion" event, so nothing regresses when this
 * feature isn't configured. Also returns `null` when detection succeeded
 * but found nothing relevant (after zone filtering) - that motion blob is
 * treated as a false positive (shadow/wind/compression noise) and no event
 * is recorded at all, which is the whole point of adding this.
 */
export interface ClassifiedMotion {
  topic: string;
  metadata: {
    areaRatio: number;
    category: ObjectDetection["category"];
    objects: ObjectDetection[];
    faces?: Array<{ name: string | null; confidence: number }>;
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchKnownFace(embedding: number[]): { name: string | null; confidence: number } {
  const knownFaces = listFaces();
  let best: { name: string; similarity: number } | null = null;
  for (const face of knownFaces) {
    const similarity = cosineSimilarity(embedding, face.embedding);
    if (!best || similarity > best.similarity) {
      best = { name: face.name, similarity };
    }
  }
  if (best && best.similarity >= env.faceMatchThreshold) {
    return { name: best.name, confidence: Math.round(best.similarity * 100) / 100 };
  }
  return { name: null, confidence: best ? Math.round(best.similarity * 100) / 100 : 0 };
}

export async function classifyMotionFrame(
  camera: Camera,
  frameJpeg: Buffer,
  areaRatio: number
): Promise<ClassifiedMotion | null> {
  // Intentionally NOT caught here: a rejection (model missing, worker down,
  // request timeout) propagates to the caller (motionDetector.ts), which
  // falls back to the plain "video:motion" event - important so enabling
  // this feature without the model files in place doesn't silently make
  // motion detection stop reporting anything at all.
  const { objects: rawObjects } = await detectObjects(frameJpeg);
  let objects = rawObjects;

  if (camera.detectionZone) {
    const zone = camera.detectionZone;
    objects = objects.filter((obj) => {
      const [x, y, w, h] = obj.box;
      return pointInPolygon([x + w / 2, y + h / 2], zone);
    });
  }

  // Per-camera opt-out of specific categories (e.g. ignore "animal" to stop
  // pets/wildlife from triggering events) - empty/null means all categories
  // count, same as before this filter existed.
  if (camera.detectionCategories && camera.detectionCategories.length > 0) {
    const allowedCategories = new Set(camera.detectionCategories);
    objects = objects.filter((obj) => allowedCategories.has(obj.category));
  }

  if (objects.length === 0) {
    // Detection ran fine but found nothing relevant (after zone
    // filtering) - a real false positive (shadow/wind/compression noise).
    // Unlike the unavailable case above, this is a deliberate suppression:
    // no event at all, no fallback to the generic "video:motion".
    return null;
  }

  const primary = objects.reduce((best, obj) => (obj.confidence > best.confidence ? obj : best));

  const metadata: ClassifiedMotion["metadata"] = { areaRatio, category: primary.category, objects };

  if (primary.category === "person" && camera.faceRecognitionEnabled) {
    try {
      const { faces } = await detectFaces(frameJpeg);
      metadata.faces = faces.map((face) => matchKnownFace(face.embedding));
    } catch (err) {
      logger.debug({ err, cameraId: camera.id }, "Face recognition unavailable for this frame");
    }
  }

  return { topic: `object:${primary.category}`, metadata };
}
