import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import type { CreateGridInput, Grid, GridBroadcastMode, UpdateGridInput } from "../types/grid.js";

interface GridRow {
  id: string;
  name: string;
  columns: number;
  camera_ids: string;
  is_public: number;
  broadcast_mode: string;
  broadcast_interval_seconds: number;
  created_at: string;
  updated_at: string;
}

function toGrid(row: GridRow): Grid {
  return {
    id: row.id,
    name: row.name,
    columns: row.columns,
    cameraIds: JSON.parse(row.camera_ids) as string[],
    isPublic: row.is_public === 1,
    broadcastMode: row.broadcast_mode as GridBroadcastMode,
    broadcastIntervalSeconds: row.broadcast_interval_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listGrids(): Grid[] {
  const rows = db.prepare("SELECT * FROM grids ORDER BY name ASC").all() as GridRow[];
  return rows.map(toGrid);
}

export function getGridById(id: string): Grid | null {
  const row = db.prepare("SELECT * FROM grids WHERE id = ?").get(id) as GridRow | undefined;
  return row ? toGrid(row) : null;
}

export function createGrid(input: CreateGridInput): Grid {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO grids (id, name, columns, camera_ids, is_public, broadcast_mode, broadcast_interval_seconds)
     VALUES (@id, @name, @columns, @cameraIds, @isPublic, @broadcastMode, @broadcastIntervalSeconds)`
  ).run({
    id,
    name: input.name,
    columns: input.columns ?? 3,
    cameraIds: JSON.stringify(input.cameraIds ?? []),
    isPublic: input.isPublic ? 1 : 0,
    broadcastMode: input.broadcastMode ?? "off",
    broadcastIntervalSeconds: input.broadcastIntervalSeconds ?? 10,
  });
  const grid = getGridById(id);
  if (!grid) {
    throw new Error("Failed to load grid after creation");
  }
  return grid;
}

export function updateGrid(id: string, input: UpdateGridInput): Grid | null {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };

  if (input.name !== undefined) {
    fields.push("name = @name");
    params.name = input.name;
  }
  if (input.columns !== undefined) {
    fields.push("columns = @columns");
    params.columns = input.columns;
  }
  if (input.cameraIds !== undefined) {
    fields.push("camera_ids = @cameraIds");
    params.cameraIds = JSON.stringify(input.cameraIds);
  }
  if (input.isPublic !== undefined) {
    fields.push("is_public = @isPublic");
    params.isPublic = input.isPublic ? 1 : 0;
  }
  if (input.broadcastMode !== undefined) {
    fields.push("broadcast_mode = @broadcastMode");
    params.broadcastMode = input.broadcastMode;
  }
  if (input.broadcastIntervalSeconds !== undefined) {
    fields.push("broadcast_interval_seconds = @broadcastIntervalSeconds");
    params.broadcastIntervalSeconds = input.broadcastIntervalSeconds;
  }

  if (fields.length === 0) {
    return getGridById(id);
  }

  db.prepare(`UPDATE grids SET ${fields.join(", ")}, updated_at = datetime('now') WHERE id = @id`).run(params);
  return getGridById(id);
}

export function deleteGrid(id: string): boolean {
  const result = db.prepare("DELETE FROM grids WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Used by requireAuth to decide whether an unauthenticated request for a
 * camera's HLS stream is allowed through: true if the camera belongs to at
 * least one grid marked `isPublic`.
 */
export function isCameraInPublicGrid(cameraId: string): boolean {
  const rows = db.prepare("SELECT camera_ids FROM grids WHERE is_public = 1").all() as { camera_ids: string }[];
  return rows.some((row) => (JSON.parse(row.camera_ids) as string[]).includes(cameraId));
}

/**
 * Used by requireAuth to decide whether an unauthenticated request for a
 * grid's broadcast HLS stream (`/hls/grid_<id>/...`, see
 * media/gridBroadcastBridge.ts) is allowed through: enabling broadcast mode
 * IS the explicit consent to expose that one stream without a session,
 * independent of the grid's own `isPublic` (interactive page) setting.
 */
export function isGridBroadcastEnabled(id: string): boolean {
  const row = db.prepare("SELECT broadcast_mode FROM grids WHERE id = ?").get(id) as { broadcast_mode: string } | undefined;
  return row ? row.broadcast_mode !== "off" : false;
}
