import path from "node:path";
import fs from "node:fs/promises";
import { listCameras } from "../db/cameras.repository.js";
import { findEventsOlderThan, deleteEventsOlderThan } from "../db/events.repository.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Daily retention cleanup: every generated asset (event rows + their
 * snapshot files) older than a camera's own `retentionDays` gets deleted,
 * both the DB record and the file on disk. Runs once per camera using that
 * camera's own setting (default 7 days), not a single global value.
 *
 * Recorded video clips are NOT handled here - MediaMTX deletes those
 * natively via its own `recordDeleteAfter` path setting, which
 * media/provisioning.ts already configures per-camera from the same
 * `camera.retentionDays` field on every (re)provision. This job only
 * covers the assets MediaMTX doesn't know about: events and snapshots.
 */

function snapshotUrlToFilePath(snapshotPath: string): string {
  // snapshot_path is a public URL path like "/snapshots/<cameraId>/<eventId>.jpg"
  // (see lib/snapshotStorage.ts) - map it back to the real file under env.snapshotsDir.
  const relative = snapshotPath.replace(/^\/snapshots\//, "");
  return path.join(env.snapshotsDir, relative);
}

async function cleanupCameraEvents(cameraId: string, retentionDays: number): Promise<void> {
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const stale = findEventsOlderThan(cameraId, cutoffIso);
  if (stale.length === 0) {
    return;
  }

  for (const event of stale) {
    if (!event.snapshot_path) continue;
    const filePath = snapshotUrlToFilePath(event.snapshot_path);
    await fs.rm(filePath, { force: true }).catch((err) => {
      logger.warn({ err, cameraId, filePath }, "Failed to delete expired snapshot file");
    });
  }

  const deleted = deleteEventsOlderThan(cameraId, cutoffIso);
  logger.info({ cameraId, retentionDays, deleted }, "Deleted expired events (retention policy)");
}

/** Removes snapshot subdirectories left behind by cameras that no longer exist (e.g. deleted cameras). */
async function cleanupOrphanedSnapshotDirs(existingCameraIds: string[]): Promise<void> {
  const existing = new Set(existingCameraIds);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(env.snapshotsDir, { withFileTypes: true });
  } catch (err) {
    logger.warn({ err }, "Failed to read snapshots directory for orphan cleanup");
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || existing.has(entry.name)) continue;
    await fs.rm(path.join(env.snapshotsDir, entry.name), { recursive: true, force: true }).catch((err) => {
      logger.warn({ err, cameraId: entry.name }, "Failed to remove orphaned snapshot directory");
    });
  }
}

export async function runRetentionCleanup(): Promise<void> {
  const cameras = listCameras();
  for (const camera of cameras) {
    try {
      await cleanupCameraEvents(camera.id, camera.retentionDays);
    } catch (err) {
      logger.warn({ err, cameraId: camera.id }, "Retention cleanup failed for camera");
    }
  }
  await cleanupOrphanedSnapshotDirs(cameras.map((c) => c.id));
}
