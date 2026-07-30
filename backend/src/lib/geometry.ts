import type { DetectionZone } from "../types/camera.js";

/**
 * Point-in-polygon test (ray casting), used to filter detections against a
 * camera's optional "zone of interest" - object detections here (see
 * media/objectDetection.ts), and mirrored in Python for plain motion
 * detection (see motion_worker.py's point_in_polygon). Both `point` and the
 * zone's `points` are normalized 0..1 coordinates, so this works regardless
 * of stream resolution.
 */
export function pointInPolygon(point: [number, number], zone: DetectionZone): boolean {
  const { points } = zone;
  if (points.length < 3) {
    return true;
  }
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}
