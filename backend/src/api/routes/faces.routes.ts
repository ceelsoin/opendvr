import { Router } from "express";
import { z } from "zod";
import { t } from "../../i18n/index.js";
import { createFace, deleteFace, listFaces } from "../../db/faces.repository.js";
import { embedSingleFace } from "../../media/visionWorker.js";
import { errorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

export const facesRouter = Router();

/** Known faces for item 3 (face recognition) - embeddings are never sent back to the client, only id/name/createdAt. */
facesRouter.get("/", (_req, res) => {
  const faces = listFaces().map(({ id, name, createdAt }) => ({ id, name, createdAt }));
  res.json(faces);
});

const createFaceSchema = z.object({
  name: z.string().min(1),
  /** Base64 JPEG/PNG of a photo containing exactly the person's face (a data: URI prefix is also accepted). */
  image: z.string().min(1),
});

facesRouter.post("/", async (req, res) => {
  const parsed = createFaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  const base64 = parsed.data.image.replace(/^data:image\/\w+;base64,/, "");

  try {
    const { embedding } = await embedSingleFace(Buffer.from(base64, "base64"));
    const face = createFace(parsed.data.name, embedding);
    res.status(201).json({ id: face.id, name: face.name, createdAt: face.createdAt });
  } catch (err) {
    const message = errorMessage(err);
    logger.warn({ err }, "Failed to enroll known face");
    if (message.includes("no_face_detected")) {
      res.status(400).json({ error: t("errors.noFaceDetected") });
      return;
    }
    if (message.includes("model_not_found")) {
      res.status(503).json({ error: t("errors.faceModelNotAvailable") });
      return;
    }
    res.status(502).json({ error: message });
  }
});

facesRouter.delete("/:id", (req, res) => {
  const deleted = deleteFace(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: t("errors.faceNotFound") });
    return;
  }
  res.status(204).end();
});
