import { randomUUID } from "node:crypto";
import { db } from "./client.js";

export interface CreateEventInput {
  cameraId: string;
  type: string;
  occurredAt?: string;
  metadata?: unknown;
}

/** Inserts a new event row and returns its generated id (used to later attach a snapshot). */
export function insertEvent(input: CreateEventInput): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO events (id, camera_id, type, occurred_at, metadata)
     VALUES (@id, @cameraId, @type, @occurredAt, @metadata)`
  ).run({
    id,
    cameraId: input.cameraId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    metadata: input.metadata !== undefined ? JSON.stringify(input.metadata) : null,
  });
  return id;
}

/** Attaches a snapshot's public URL path to an already-inserted event (snapshot capture happens asynchronously). */
export function updateEventSnapshot(id: string, snapshotPath: string): void {
  db.prepare("UPDATE events SET snapshot_path = ? WHERE id = ?").run(snapshotPath, id);
}

export function markEventRead(id: string, read: boolean): boolean {
  const result = db.prepare("UPDATE events SET read = ? WHERE id = ?").run(read ? 1 : 0, id);
  return result.changes > 0;
}

export function deleteEvent(id: string): boolean {
  const result = db.prepare("DELETE FROM events WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface StaleEventRow {
  id: string;
  snapshot_path: string | null;
}

/** Lists events for a camera older than `cutoffIso`, for the retention cleanup job (see jobs/retentionCleanup.ts) - queried first to know which snapshot files to delete before removing the rows. */
export function findEventsOlderThan(cameraId: string, cutoffIso: string): StaleEventRow[] {
  return db
    .prepare("SELECT id, snapshot_path FROM events WHERE camera_id = ? AND occurred_at < ?")
    .all(cameraId, cutoffIso) as StaleEventRow[];
}

/** Deletes events for a camera older than `cutoffIso`; returns how many rows were removed. */
export function deleteEventsOlderThan(cameraId: string, cutoffIso: string): number {
  const result = db.prepare("DELETE FROM events WHERE camera_id = ? AND occurred_at < ?").run(cameraId, cutoffIso);
  return result.changes;
}

