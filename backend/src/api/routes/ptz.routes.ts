import { Router } from "express";
import { z } from "zod";
import { getCameraById } from "../../db/cameras.repository.js";
import { ptzGotoPreset, ptzListPresets, ptzMove, ptzMoveVector, ptzSetPreset, ptzStop } from "../../onvif/ptz.js";
import { errorMessage } from "../../lib/errors.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../lib/logger.js";

export const ptzRouter = Router();

const directionSchema = z.enum([
  "up", "down", "left", "right", "upLeft", "upRight", "downLeft", "downRight",
]);

// Either a fixed 8-way direction (legacy button-style control) or an
// arbitrary-angle pan/tilt vector (joystick-style control) - see
// docs/api-reference.md for the shape of each.
const moveBodySchema = z.union([
  z.object({ direction: directionSchema, speed: z.number().min(0).max(1).optional() }),
  z.object({ pan: z.number().min(-1).max(1), tilt: z.number().min(-1).max(1) }),
]);

function loadCameraOr404(id: string, res: import("express").Response) {
  const camera = getCameraById(id);
  if (!camera) {
    res.status(404).json({ error: t("errors.cameraNotFound") });
    return null;
  }
  return camera;
}

ptzRouter.post("/:id/move", async (req, res) => {
  const camera = loadCameraOr404(req.params.id, res);
  if (!camera) return;

  const parsed = moveBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload") });
    return;
  }
  try {
    if ("direction" in parsed.data) {
      await ptzMove(camera, parsed.data.direction, parsed.data.speed);
    } else {
      await ptzMoveVector(camera, parsed.data);
    }
    res.status(204).send();
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "PTZ move failed");
    res.status(502).json({ error: t("errors.ptzMoveFailed"), details: errorMessage(err) });
  }
});

ptzRouter.post("/:id/stop", async (req, res) => {
  const camera = loadCameraOr404(req.params.id, res);
  if (!camera) return;
  try {
    await ptzStop(camera);
    res.status(204).send();
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "PTZ stop failed");
    res.status(502).json({ error: t("errors.ptzStopFailed"), details: errorMessage(err) });
  }
});

ptzRouter.get("/:id/presets", async (req, res) => {
  const camera = loadCameraOr404(req.params.id, res);
  if (!camera) return;
  try {
    const presets = await ptzListPresets(camera);
    res.json(presets);
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to list PTZ presets");
    res.status(502).json({ error: t("errors.ptzPresetsListFailed"), details: errorMessage(err) });
  }
});

ptzRouter.post("/:id/presets", async (req, res) => {
  const camera = loadCameraOr404(req.params.id, res);
  if (!camera) return;
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload") });
    return;
  }
  try {
    const result = await ptzSetPreset(camera, parsed.data.name);
    res.status(201).json(result);
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to set PTZ preset");
    res.status(502).json({ error: t("errors.ptzPresetSetFailed"), details: errorMessage(err) });
  }
});

ptzRouter.post("/:id/presets/:token/goto", async (req, res) => {
  const camera = loadCameraOr404(req.params.id, res);
  if (!camera) return;
  try {
    await ptzGotoPreset(camera, req.params.token);
    res.status(204).send();
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to go to PTZ preset");
    res.status(502).json({ error: t("errors.ptzPresetGotoFailed"), details: errorMessage(err) });
  }
});
