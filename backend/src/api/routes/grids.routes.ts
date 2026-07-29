import { Router } from "express";
import { z } from "zod";
import { createGrid, deleteGrid, getGridById, listGrids, updateGrid } from "../../db/grids.repository.js";
import { t } from "../../i18n/index.js";

export const gridsRouter = Router();

const createGridSchema = z.object({
  name: z.string().min(1),
  columns: z.number().int().min(1).max(8).optional(),
  cameraIds: z.array(z.string()).default([]),
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

gridsRouter.post("/", (req, res) => {
  const parsed = createGridSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  const grid = createGrid(parsed.data);
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
  res.json(updated);
});

gridsRouter.delete("/:id", (req, res) => {
  const deleted = deleteGrid(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: t("errors.gridNotFound") });
    return;
  }
  res.status(204).send();
});
