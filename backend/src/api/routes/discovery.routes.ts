import { Router } from "express";
import { z } from "zod";
import { discoverCameras } from "../../onvif/discovery.js";
import { scanNetwork, type ScanEvent } from "../../onvif/networkScan.js";
import { parseIpRange } from "../../lib/ipRange.js";
import { errorMessage } from "../../lib/errors.js";
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

const scanSchema = z.object({
  range: z.string().min(1),
  username: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Active TCP range scan for ONVIF/RTSP cameras (see onvif/networkScan.ts
 * for why this exists alongside WS-Discovery above). Streams newline-
 * delimited JSON progress events as the scan runs, instead of a single
 * response at the end - lets the frontend show a live, terminal-style log
 * even for ranges that take a while to fully scan.
 */
discoveryRouter.post("/scan", async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  let hosts: string[];
  try {
    hosts = parseIpRange(parsed.data.range);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.flushHeaders();

  const write = (event: ScanEvent) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  write({ type: "start", totalHosts: hosts.length });

  try {
    await scanNetwork(hosts, { username: parsed.data.username, password: parsed.data.password }, write);
    write({ type: "done" });
  } catch (err) {
    logger.error({ err }, "Network scan failed");
    write({ type: "error", message: errorMessage(err) });
  } finally {
    res.end();
  }
});
