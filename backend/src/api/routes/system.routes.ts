import { Router } from "express";
import { getSystemStats } from "../../lib/systemStats.js";
import { logger } from "../../lib/logger.js";
import { errorMessage } from "../../lib/errors.js";

export const systemRouter = Router();

systemRouter.get("/stats", async (_req, res) => {
  try {
    const stats = await getSystemStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "Failed to read system stats");
    res.status(500).json({ error: errorMessage(err) });
  }
});
