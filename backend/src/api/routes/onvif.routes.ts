import { Router } from "express";
import { z } from "zod";
import { discoverStreams } from "../../onvif/device.js";
import { diagnoseSoapCompatibility } from "../../onvif/diagnose.js";
import { listOnvifDebugCommands, runOnvifDebugCommand } from "../../onvif/debugCommands.js";
import { getCameraById } from "../../db/cameras.repository.js";
import { parseOnvifUri } from "../../lib/onvifUri.js";
import { errorMessage } from "../../lib/errors.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../lib/logger.js";

export const onvifRouter = Router();

const probeSchema = z.object({
  onvifUrl: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  onvifPath: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Connects to a camera via ONVIF (either from a full service URL like
 * `http://user:pass@host:port/onvif`, or from separate fields) and returns
 * every media profile's resolved RTSP stream URI, so the frontend can offer
 * a "pick your main/sub stream" dropdown (à la Agent DVR / iSpy).
 * Nothing is persisted here - this is a preview/probe step.
 */
onvifRouter.post("/probe", async (req, res) => {
  const parsed = probeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }

  let { host, port, onvifPath, username, password } = parsed.data;

  if (parsed.data.onvifUrl) {
    try {
      const fromUrl = parseOnvifUri(parsed.data.onvifUrl);
      host = fromUrl.host;
      port = fromUrl.port;
      onvifPath = fromUrl.onvifPath;
      username = fromUrl.username || username;
      password = fromUrl.password || password;
    } catch {
      res.status(400).json({ error: t("errors.onvifUrlInvalid") });
      return;
    }
  }

  if (!host || !username || !password) {
    res.status(400).json({ error: t("errors.onvifCredentialsRequired") });
    return;
  }

  const resolvedPort = port ?? 80;
  const resolvedPath = onvifPath || "/onvif/device_service";
  const camera = { host, port: resolvedPort, onvifPath: resolvedPath, username, password };

  try {
    const streams = await discoverStreams(camera);
    res.json({
      host,
      port: resolvedPort,
      onvifPath: resolvedPath,
      username,
      streams,
    });
  } catch (err) {
    const details = errorMessage(err);
    logger.warn({ err, host, port: resolvedPort }, "ONVIF probe failed");
    res.status(502).json({
      error: t("errors.onvifConnectionFailed"),
      details,
    });
  }
});

const diagnoseSchema = z.object({
  onvifUrl: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  onvifPath: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Diagnostic-only endpoint (not used by the normal camera flow): sends the
 * same unauthenticated ONVIF call in both SOAP 1.1 and SOAP 1.2 wire formats
 * directly (bypassing the `onvif` package), to determine whether a camera
 * that resets the connection during the real ONVIF handshake is doing so
 * because of a SOAP-version incompatibility.
 */
onvifRouter.post("/diagnose", async (req, res) => {
  const parsed = diagnoseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }

  let { host, port, onvifPath, username, password } = parsed.data;
  if (parsed.data.onvifUrl) {
    try {
      const fromUrl = parseOnvifUri(parsed.data.onvifUrl);
      host = fromUrl.host;
      port = fromUrl.port;
      onvifPath = fromUrl.onvifPath;
      username = fromUrl.username || username;
      password = fromUrl.password || password;
    } catch {
      res.status(400).json({ error: t("errors.onvifUrlInvalid") });
      return;
    }
  }

  if (!host) {
    res.status(400).json({ error: t("errors.onvifHostRequired") });
    return;
  }

  const resolvedPort = port ?? 80;
  const resolvedPath = onvifPath || "/onvif/device_service";

  const results = await diagnoseSoapCompatibility(
    host,
    resolvedPort,
    resolvedPath,
    username && password ? { username, password } : undefined
  );
  res.json({ host, port: resolvedPort, onvifPath: resolvedPath, results });
});

/** Lists every command available in the ONVIF debug terminal (GridPage-adjacent debug screen), with usage/description for a help panel. */
onvifRouter.get("/debug/commands", (_req, res) => {
  res.json({ commands: listOnvifDebugCommands() });
});

const debugExecuteSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

/**
 * Executes a single ONVIF debug command against a stored camera (never
 * accepts raw credentials from the request - always resolves the camera by
 * id and uses its saved host/user/pass). Used by the "/comando" terminal UI.
 */
onvifRouter.post("/debug/:cameraId", async (req, res) => {
  const camera = getCameraById(req.params.cameraId);
  if (!camera) {
    res.status(404).json({ error: t("errors.cameraNotFound") });
    return;
  }

  const parsed = debugExecuteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runOnvifDebugCommand(camera, parsed.data.command, parsed.data.args);
    res.json({ ok: true, result });
  } catch (err) {
    const details = errorMessage(err);
    logger.warn({ err, cameraId: camera.id, command: parsed.data.command }, "ONVIF debug command failed");
    res.status(502).json({ ok: false, error: details });
  }
});
