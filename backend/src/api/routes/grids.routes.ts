import { Router } from "express";
import { z } from "zod";
import { createGrid, deleteGrid, getGridById, listGrids, updateGrid } from "../../db/grids.repository.js";
import { getCameraById } from "../../db/cameras.repository.js";
import { stopGridBroadcastCompletely, syncGridBroadcast } from "../../media/gridBroadcastBridge.js";
import type { PublicGridCamera } from "../../types/grid.js";
import { t } from "../../i18n/index.js";

export const gridsRouter = Router();

const createGridSchema = z.object({
  name: z.string().min(1),
  columns: z.number().int().min(1).max(8).optional(),
  cameraIds: z.array(z.string()).default([]),
  isPublic: z.boolean().optional(),
  broadcastMode: z.enum(["off", "mosaic", "rotation"]).optional(),
  // Lower bound avoids thrashing ffmpeg/MediaMTX with near-instant camera
  // switches; upper bound is just a sane cap, not a technical limit.
  broadcastIntervalSeconds: z.number().int().min(3).max(300).optional(),
});

const updateGridSchema = createGridSchema.partial();

gridsRouter.get("/", (_req, res) => {
  res.json(listGrids());
});

// No auth on this endpoint (matches the rest of the API): the grid's id is
// itself the unique, shareable URL used to pin a layout to a specific
// device (see frontend route /g/:id).
gridsRouter.get("/:id", (req, res) => {
  const grid = getGridById(req.params.id);
  if (!grid) {
    res.status(404).json({ error: t("errors.gridNotFound") });
    return;
  }
  res.json(grid);
});

// Bypasses requireAuth (see auth/requireAuth.ts) when the grid is marked
// public - returns a credential-free camera shape (no host/username/RTSP
// URIs) so an anonymous viewer only ever gets what's needed to render the
// tiles for this specific grid.
gridsRouter.get("/:id/public", (req, res) => {
  const grid = getGridById(req.params.id);
  if (!grid || !grid.isPublic) {
    res.status(404).json({ error: t("errors.gridNotFound") });
    return;
  }
  const cameras: PublicGridCamera[] = grid.cameraIds
    .map((id) => getCameraById(id))
    .filter((camera): camera is NonNullable<typeof camera> => Boolean(camera))
    .map((camera) => ({
      id: camera.id,
      name: camera.name,
      rotation: camera.rotation,
      hasSubStream: Boolean(camera.subStreamWidth) && camera.rtspCompatMode !== "vlc-relay",
    }));
  res.json({ id: grid.id, name: grid.name, columns: grid.columns, cameras });
});

gridsRouter.post("/", (req, res) => {
  const parsed = createGridSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  const grid = createGrid(parsed.data);
  void syncGridBroadcast(grid);
  res.status(201).json(grid);
});

gridsRouter.patch("/:id", (req, res) => {
  const existing = getGridById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: t("errors.gridNotFound") });
    return;
  }
  const parsed = updateGridSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  const updated = updateGrid(req.params.id, parsed.data);
  if (updated) {
    void syncGridBroadcast(updated);
  }
  res.json(updated);
});

gridsRouter.delete("/:id", (req, res) => {
  const deleted = deleteGrid(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: t("errors.gridNotFound") });
    return;
  }
  void stopGridBroadcastCompletely(req.params.id);
  res.status(204).send();
});
