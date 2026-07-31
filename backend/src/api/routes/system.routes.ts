import { Router } from "express";
import { getSystemStats } from "../../lib/systemStats.js";
import { getProcessHealth } from "../../lib/processHealth.js";
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

/** Process/health visibility for VLC relay, MediaMTX, ffmpeg bridges, motion workers, the vision worker, grid broadcasts, and the captioning provider - see lib/processHealth.ts. */
systemRouter.get("/processes", async (_req, res) => {
  try {
    const health = await getProcessHealth();
    res.json(health);
  } catch (err) {
    logger.error({ err }, "Failed to read process health");
    res.status(500).json({ error: errorMessage(err) });
  }
});
