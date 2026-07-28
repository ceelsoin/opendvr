import { Router } from "express";
import { discoverCameras } from "../../onvif/discovery.js";
import { logger } from "../../lib/logger.js";

export const discoveryRouter = Router();

/** Runs a WS-Discovery probe on the LAN and returns unauthenticated devices found. */
discoveryRouter.post("/", async (req, res) => {
  const timeout = Number(req.body?.timeoutMs) || 5000;
  try {
    const devices = await discoverCameras(timeout);
    res.json(devices);
  } catch (err) {
    logger.error({ err }, "ONVIF discovery failed");
    res.status(500).json({ error: "Discovery failed" });
  }
});
