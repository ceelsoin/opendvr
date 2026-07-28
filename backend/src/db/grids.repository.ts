import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import type { CreateGridInput, Grid, UpdateGridInput } from "../types/grid.js";

interface GridRow {
  id: string;
  name: string;
  columns: number;
  camera_ids: string;
  created_at: string;
  updated_at: string;
}

function toGrid(row: GridRow): Grid {
  return {
    id: row.id,
    name: row.name,
    columns: row.columns,
    cameraIds: JSON.parse(row.camera_ids) as string[],
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
    `INSERT INTO grids (id, name, columns, camera_ids) VALUES (@id, @name, @columns, @cameraIds)`
  ).run({
    id,
    name: input.name,
    columns: input.columns ?? 3,
    cameraIds: JSON.stringify(input.cameraIds ?? []),
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
