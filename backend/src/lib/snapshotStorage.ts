import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

/**
 * Persists an event's snapshot JPEG to disk under env.snapshotsDir, and
 * returns the public URL path it's served at (see app.ts's
 * `express.static(env.snapshotsDir)` mount at /snapshots).
 */
export async function saveEventSnapshot(cameraId: string, eventId: string, buffer: Buffer): Promise<string> {
  const dir = path.join(env.snapshotsDir, cameraId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${eventId}.jpg`);
  await fs.writeFile(filePath, buffer);
  return `/snapshots/${cameraId}/${eventId}.jpg`;
}

/** Same storage/serving convention as saveEventSnapshot above, for a bbox-annotated copy of the event clip (see media/clipRenderer.ts) - same directory/route, distinguished only by extension. */
export async function saveEventClip(cameraId: string, eventId: string, buffer: Buffer): Promise<string> {
  const dir = path.join(env.snapshotsDir, cameraId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${eventId}.mp4`);
  await fs.writeFile(filePath, buffer);
  return `/snapshots/${cameraId}/${eventId}.mp4`;
}
