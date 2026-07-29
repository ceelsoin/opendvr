import { Router } from "express";
import { z } from "zod";
import {
  createCamera,
  deleteCamera,
  getCameraById,
  listCameras,
  setCameraEnabled,
  toPublicCamera,
  updateCamera,
} from "../../db/cameras.repository.js";
import { discoverStreams } from "../../onvif/device.js";
import { deleteCameraPath, getCameraPathStatus } from "../../media/mediamtx.js";
import { provisionCamera } from "../../media/provisioning.js";
import { getVlcRelayUrl, stopVlcRelay } from "../../media/vlcRelay.js";
import { stopMjpegBridge } from "../../media/mjpegBridge.js";
import { stopWebpageBridge } from "../../media/webpageBridge.js";
import { stopMotionRecording } from "../../media/motionRecording.js";
import { restartMotionListening, shouldDetectMotion, startMotionListening, stopMotionListening } from "../../media/motionOrchestrator.js";
import { errorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

export const camerasRouter = Router();

const streamMetadataSchema = z.object({
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  encoding: z.string().nullable(),
});

const baseCameraSchema = z.object({
  name: z.string().min(1),
  // "onvif" (default, unchanged behavior) or a directly-entered stream URL
  // of that protocol - see types/camera.ts's CameraSourceType doc comment.
  sourceType: z.enum(["onvif", "rtsp", "rtmp", "hls", "srt", "mjpeg-http", "webpage"]).optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  onvifPath: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  mainProfileToken: z.string().optional(),
  subProfileToken: z.string().optional(),
  rtspMainUri: z.string().optional(),
  rtspSubUri: z.string().optional(),
  rtspCompatMode: z.enum(["vlc-relay"]).nullable().optional(),
  mainStreamMetadata: streamMetadataSchema.optional(),
  subStreamMetadata: streamMetadataSchema.optional(),
  hasPtz: z.boolean().optional(),
  recordingMode: z.enum(["off", "continuous", "motion"]).optional(),
  motionRecording: z.boolean().optional(),
  motionDetectionSource: z.enum(["onvif", "video"]).optional(),
  retentionDays: z.number().int().positive().optional(),
});

// host/username/password are only required for "onvif" cameras (the
// default); "rtsp"/"rtmp"/"hls"/"srt" cameras just need a directly-entered
// `rtspMainUri` instead - see types/camera.ts's CameraSourceType.
const createCameraSchema = baseCameraSchema.superRefine((data, ctx) => {
  const sourceType = data.sourceType ?? "onvif";
  if (sourceType === "onvif") {
    if (!data.host) ctx.addIssue({ code: "custom", message: "Host é obrigatório.", path: ["host"] });
    if (!data.username) ctx.addIssue({ code: "custom", message: "Usuário é obrigatório.", path: ["username"] });
    if (!data.password) ctx.addIssue({ code: "custom", message: "Senha é obrigatória.", path: ["password"] });
  } else if (!data.rtspMainUri) {
    ctx.addIssue({ code: "custom", message: "URL do stream é obrigatória.", path: ["rtspMainUri"] });
  }
});

const updateCameraSchema = baseCameraSchema.partial();

camerasRouter.get("/", (_req, res) => {
  const cameras = listCameras().map(toPublicCamera);
  res.json(cameras);
});

camerasRouter.get("/:id", (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  res.json(toPublicCamera(camera));
});

/**
 * Reads MediaMTX's live view of the camera's stream: is a path even
 * configured, is the RTSP source actually connected ("ready"), how many
 * viewers/readers are attached. Useful to diagnose "camera shows online but
 * player says stream unavailable" - that gap means ONVIF connected fine but
 * MediaMTX itself is failing to pull the RTSP stream (wrong transport,
 * camera rejected credentials over RTSP, etc), a different failure mode
 * than ONVIF connectivity.
 */
camerasRouter.get("/:id/stream-status", async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  const status = await getCameraPathStatus(camera.id);
  res.json({
    ...status,
    hlsUrl: `/hls/${camera.id}/index.m3u8`,
    relayUrl: camera.rtspCompatMode === "vlc-relay" ? getVlcRelayUrl(camera.id) : null,
  });
});

camerasRouter.post("/", async (req, res) => {
  const parsed = createCameraSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const camera = createCamera(parsed.data);

  // Best-effort provisioning: the camera row is already created even if the
  // ONVIF/MediaMTX steps below fail (e.g. camera unreachable).
  await provisionCamera(camera);
  if (shouldDetectMotion(camera)) {
    void startMotionListening(camera);
  }

  const finalCamera = getCameraById(camera.id) ?? camera;
  res.status(201).json(toPublicCamera(finalCamera));
});

camerasRouter.patch("/:id", async (req, res) => {
  const existing = getCameraById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const parsed = updateCameraSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  // Editing connection details invalidates any previously resolved stream
  // URI, forcing a fresh ONVIF lookup on the next provisioning pass.
  const connectionFieldsChanged = ["host", "port", "onvifPath", "username", "password", "mainProfileToken"].some(
    (key) => key in parsed.data
  );
  const updated = updateCamera(req.params.id, {
    ...parsed.data,
    ...(connectionFieldsChanged && !parsed.data.rtspMainUri ? { rtspMainUri: undefined } : {}),
  });
  if (!updated) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  await provisionCamera(updated, { forceRefresh: connectionFieldsChanged });

  if (shouldDetectMotion(updated)) {
    await restartMotionListening(updated);
  } else {
    stopMotionListening(updated.id);
  }
  if (updated.recordingMode !== "motion") {
    stopMotionRecording(updated.id);
  }

  const finalCamera = getCameraById(updated.id) ?? updated;
  res.json(toPublicCamera(finalCamera));
});

/** Forces a full reconnect: re-resolves the RTSP URI via ONVIF and re-registers the MediaMTX path. */
camerasRouter.post("/:id/restart", async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const status = await provisionCamera(camera, { forceRefresh: true });
  if (shouldDetectMotion(camera)) {
    await restartMotionListening(camera);
  }

  res.json({ ok: status === "online", status });
});

camerasRouter.delete("/:id", async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  stopMotionListening(camera.id);
  stopMotionRecording(camera.id);
  await stopVlcRelay(camera.id);
  await stopMjpegBridge(camera.id);
  await stopWebpageBridge(camera.id);
  await deleteCameraPath(camera.id);
  deleteCamera(camera.id);
  res.status(204).send();
});

/**
 * Administrative on/off switch (distinct from `status`, which reflects
 * connectivity): tears down everything provisioning set up (MediaMTX path,
 * motion listener, motion recording, VLC relay) but keeps the camera's row
 * and config intact, so it can be re-enabled later without re-entering
 * anything.
 */
camerasRouter.post("/:id/disable", async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  stopMotionListening(camera.id);
  stopMotionRecording(camera.id);
  await stopVlcRelay(camera.id);
  await stopMjpegBridge(camera.id);
  await stopWebpageBridge(camera.id);
  await deleteCameraPath(camera.id);
  const updated = setCameraEnabled(camera.id, false);
  res.json(toPublicCamera(updated ?? camera));
});

/** Re-provisions a previously disabled camera (fresh ONVIF lookup, same as /restart) and resumes motion detection if configured. */
camerasRouter.post("/:id/enable", async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  const enabledCamera = setCameraEnabled(camera.id, true);
  if (!enabledCamera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  await provisionCamera(enabledCamera, { forceRefresh: true });
  if (shouldDetectMotion(enabledCamera)) {
    await startMotionListening(enabledCamera);
  }
  const finalCamera = getCameraById(enabledCamera.id) ?? enabledCamera;
  res.json(toPublicCamera(finalCamera));
});

/** Tests ONVIF connectivity for a stored camera and lists its available stream profiles. */
camerasRouter.post("/:id/test-connection", async (req, res) => {
  const camera = getCameraById(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  try {
    const streams = await discoverStreams(camera);
    res.json({ ok: true, streams });
  } catch (err) {
    const details = errorMessage(err);
    logger.warn({ err, cameraId: camera.id }, "ONVIF connection test failed");
    res.status(502).json({
      ok: false,
      error: "Não foi possível conectar à câmera via ONVIF. Verifique host, porta, caminho ONVIF e credenciais.",
      details,
    });
  }
});
