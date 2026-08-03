import { randomUUID } from "node:crypto";
import { db } from "./client.js";

export interface CreateEventInput {
  cameraId: string;
  type: string;
  occurredAt?: string;
  metadata?: unknown;
  /** Which detection pipelines produced this event (e.g. "video_motion", "object_detection", "face_recognition", "onvif_event") - see events/cameraEvents.ts's buildPipelineInfo. */
  pipelines?: string[];
  /** Each pipeline's raw output, keyed by pipeline name - same keys as `pipelines`. */
  pipelineOutputs?: Record<string, unknown>;
}

/** Inserts a new event row and returns its generated id (used to later attach a snapshot). */
export function insertEvent(input: CreateEventInput): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO events (id, camera_id, type, occurred_at, metadata, pipelines, pipeline_outputs)
     VALUES (@id, @cameraId, @type, @occurredAt, @metadata, @pipelines, @pipelineOutputs)`
  ).run({
    id,
    cameraId: input.cameraId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    metadata: input.metadata !== undefined ? JSON.stringify(input.metadata) : null,
    pipelines: JSON.stringify(input.pipelines ?? []),
    pipelineOutputs: input.pipelineOutputs ? JSON.stringify(input.pipelineOutputs) : null,
  });
  return id;
}

/** Attaches a snapshot's public URL path to an already-inserted event (snapshot capture happens asynchronously). `annotated` records whether that file has bounding boxes drawn on it (see media/snapshotRenderer.ts). */
export function updateEventSnapshot(id: string, snapshotPath: string, annotated = false): void {
  db.prepare("UPDATE events SET snapshot_path = ?, snapshot_annotated = ? WHERE id = ?").run(snapshotPath, annotated ? 1 : 0, id);
}

/** Attaches an auto-generated VLM caption to an already-inserted event (captioning happens asynchronously, after the snapshot is captured). */
export function updateEventCaption(id: string, caption: string): void {
  db.prepare("UPDATE events SET caption = ? WHERE id = ?").run(caption, id);
}

/** Attaches a bbox-annotated copy of the event clip (see media/clipRenderer.ts) - an additional artifact, never replaces the raw clip sent to notifications. */
export function updateEventClipAnnotated(id: string, clipPath: string): void {
  db.prepare("UPDATE events SET clip_annotated_path = ? WHERE id = ?").run(clipPath, id);
}

/**
 * Adds a pipeline (if not already tagged) and its output to an already-
 * inserted event - used for pipelines that only resolve asynchronously
 * after the initial insert (currently just "captioning", see
 * events/cameraEvents.ts). Safe to call on an event that no longer exists
 * (e.g. deleted in the meantime) - just a no-op.
 */
export function appendEventPipelineOutput(id: string, pipeline: string, output: unknown): void {
  const row = db.prepare("SELECT pipelines, pipeline_outputs FROM events WHERE id = ?").get(id) as
    | { pipelines: string; pipeline_outputs: string | null }
    | undefined;
  if (!row) return;

  const pipelines: string[] = JSON.parse(row.pipelines || "[]");
  if (!pipelines.includes(pipeline)) {
    pipelines.push(pipeline);
  }
  const outputs: Record<string, unknown> = row.pipeline_outputs ? JSON.parse(row.pipeline_outputs) : {};
  outputs[pipeline] = output;

  db.prepare("UPDATE events SET pipelines = ?, pipeline_outputs = ? WHERE id = ?").run(
    JSON.stringify(pipelines),
    JSON.stringify(outputs),
    id
  );
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

