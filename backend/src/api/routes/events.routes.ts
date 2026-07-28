import { Router } from "express";
import { db } from "../../db/client.js";
import { getCameraById } from "../../db/cameras.repository.js";
import { deleteEvent, markEventRead } from "../../db/events.repository.js";

export const eventsRouter = Router();

interface EventRow {
  id: string;
  camera_id: string;
  type: string;
  occurred_at: string;
  metadata: string | null;
  read: number;
  snapshot_path: string | null;
}

function serializeEvent(row: EventRow) {
  return {
    id: row.id,
    camera_id: row.camera_id,
    type: row.type,
    occurred_at: row.occurred_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    read: Boolean(row.read),
    snapshotUrl: row.snapshot_path,
  };
}

eventsRouter.get("/", (req, res) => {
  const cameraId = req.query.cameraId ? String(req.query.cameraId) : null;
  const type = req.query.type ? String(req.query.type) : null;
  const from = String(req.query.from ?? "1970-01-01T00:00:00.000Z");
  const to = String(req.query.to ?? new Date().toISOString());

  if (cameraId && !getCameraById(cameraId)) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const conditions: string[] = ["occurred_at >= ?", "occurred_at <= ?"];
  const params: unknown[] = [from, to];
  if (cameraId) {
    conditions.push("camera_id = ?");
    params.push(cameraId);
  }
  if (type) {
    conditions.push("type = ?");
    params.push(type);
  }

  const rows = db
    .prepare(`SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY occurred_at DESC`)
    .all(...params) as EventRow[];

  res.json(rows.map(serializeEvent));
});

eventsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id) as EventRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(serializeEvent(row));
});

eventsRouter.patch("/:id", (req, res) => {
  const read = Boolean(req.body?.read);
  const updated = markEventRead(req.params.id, read);
  if (!updated) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id) as EventRow;
  res.json(serializeEvent(row));
});

eventsRouter.delete("/:id", (req, res) => {
  const deleted = deleteEvent(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.status(204).send();
});

