import { randomUUID } from "node:crypto";
import { db } from "./client.js";

export interface KnownFace {
  id: string;
  name: string;
  /** SFace 128-d embedding vector. */
  embedding: number[];
  createdAt: string;
}

interface KnownFaceRow {
  id: string;
  name: string;
  embedding: string;
  created_at: string;
}

function toFace(row: KnownFaceRow): KnownFace {
  return { id: row.id, name: row.name, embedding: JSON.parse(row.embedding), createdAt: row.created_at };
}

export function listFaces(): KnownFace[] {
  const rows = db.prepare("SELECT * FROM known_faces ORDER BY name ASC").all() as KnownFaceRow[];
  return rows.map(toFace);
}

export function createFace(name: string, embedding: number[]): KnownFace {
  const id = randomUUID();
  db.prepare("INSERT INTO known_faces (id, name, embedding) VALUES (@id, @name, @embedding)").run({
    id,
    name,
    embedding: JSON.stringify(embedding),
  });
  const row = db.prepare("SELECT * FROM known_faces WHERE id = ?").get(id) as KnownFaceRow;
  return toFace(row);
}

export function deleteFace(id: string): boolean {
  const result = db.prepare("DELETE FROM known_faces WHERE id = ?").run(id);
  return result.changes > 0;
}
