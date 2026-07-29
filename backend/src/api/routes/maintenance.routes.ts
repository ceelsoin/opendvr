import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../../db/client.js";
import { listCameras } from "../../db/cameras.repository.js";
import { getUserById, updateUserPassword } from "../../db/users.repository.js";
import { deleteCameraPath } from "../../media/mediamtx.js";
import { stopMotionListening } from "../../media/motionOrchestrator.js";
import { stopMotionRecording } from "../../media/motionRecording.js";
import { stopAllVlcRelays } from "../../media/vlcRelay.js";
import { stopAllMjpegBridges } from "../../media/mjpegBridge.js";
import { stopAllWebpageBridges } from "../../media/webpageBridge.js";
import { stopAllRotationBridges } from "../../media/rotationBridge.js";
import { stopAllTimestampBridges } from "../../media/timestampBridge.js";
import { stopAllRecordings } from "../../media/recorder.js";
import { stopAllMotionDetectors } from "../../media/motionDetector.js";
import { env } from "../../config/env.js";
import { getLogEntries, getLastLogSeq } from "../../lib/logBuffer.js";
import { errorMessage } from "../../lib/errors.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../lib/logger.js";

export const maintenanceRouter = Router();

/**
 * Tail of recent backend log entries (see lib/logBuffer.ts), optionally
 * scoped to one camera. Powers both the Maintenance page's general log
 * viewer and the per-camera "restart"/"test connection" log modals on the
 * Cameras page - those poll this with an increasing `afterSeq` (the last
 * `seq` they've already rendered) to get a live tail without re-fetching
 * everything each time.
 */
maintenanceRouter.get("/logs", (req, res) => {
  const cameraId = typeof req.query.cameraId === "string" ? req.query.cameraId : undefined;
  const afterSeq = typeof req.query.afterSeq === "string" ? Number(req.query.afterSeq) : undefined;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const entries = getLogEntries({
    cameraId,
    afterSeq: Number.isFinite(afterSeq) ? afterSeq : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  res.json({ entries, lastSeq: getLastLogSeq() });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

/** Requires the current password (defense in depth - the session cookie alone isn't considered enough for this). */
maintenanceRouter.post("/change-password", async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }

  const user = req.user?.sub ? getUserById(req.user.sub) : null;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const validCurrent = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!validCurrent) {
    res.status(400).json({ error: t("errors.invalidCredentials") });
    return;
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  updateUserPassword(user.id, newHash);
  logger.info({ username: user.username }, "Senha do administrador alterada");
  res.json({ ok: true });
});

/**
 * Restarts the backend process - relies entirely on docker-compose.yml's
 * `restart: unless-stopped` policy to bring it back up; there's no
 * in-process "reload" here on purpose (a fresh process is the most
 * reliable way to clear any wedged state - stuck relay/bridge processes,
 * leaked handles, etc). Responds BEFORE exiting so the frontend actually
 * gets the 202 instead of the connection just dying.
 */
maintenanceRouter.post("/restart-server", (_req, res) => {
  logger.warn("Reinício do servidor solicitado pelo usuário");
  res.status(202).json({ ok: true });
  setTimeout(() => process.exit(0), 300);
});

const factoryResetSchema = z.object({ password: z.string().min(1) });

/**
 * Wipes every camera, recording, event, grid, setting, and user account -
 * back to a blank install (next load shows the Setup page again, same as a
 * brand new deployment). Requires the current password as an extra
 * confirmation beyond just the session cookie, given how destructive and
 * irreversible this is - the frontend also requires typing a confirmation
 * phrase before this is ever called (see MaintenancePage.tsx).
 */
maintenanceRouter.post("/factory-reset", async (req, res) => {
  const parsed = factoryResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload") });
    return;
  }

  const user = req.user?.sub ? getUserById(req.user.sub) : null;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    res.status(400).json({ error: t("errors.invalidCredentials") });
    return;
  }

  logger.warn({ username: user.username }, "RESET DE FÁBRICA solicitado - apagando todos os dados");

  for (const camera of listCameras()) {
    stopMotionListening(camera.id);
    stopMotionRecording(camera.id);
    await deleteCameraPath(camera.id).catch(() => {});
  }
  stopAllVlcRelays();
  stopAllMjpegBridges();
  await stopAllWebpageBridges();
  stopAllRotationBridges();
  stopAllTimestampBridges();
  stopAllRecordings();
  stopAllMotionDetectors();

  db.exec(`
    DELETE FROM cameras;
    DELETE FROM recordings;
    DELETE FROM events;
    DELETE FROM grids;
    DELETE FROM settings;
    DELETE FROM users;
  `);

  await fs.rm(env.recordingsDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(env.snapshotsDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(env.recordingsDir, { recursive: true }).catch(() => {});
  await fs.mkdir(env.snapshotsDir, { recursive: true }).catch(() => {});

  res.json({ ok: true });
  setTimeout(() => process.exit(0), 500);
});

const deleteRecordingsSchema = z.object({ cameraId: z.string().optional() });

/** Deletes recorded video files for one camera, or every camera (`cameraId` omitted) - MediaMTX manages these files natively, so this only touches the filesystem, not any DB table. */
maintenanceRouter.post("/recordings/delete", async (req, res) => {
  const parsed = deleteRecordingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload") });
    return;
  }

  try {
    if (parsed.data.cameraId) {
      const dir = path.join(env.recordingsDir, parsed.data.cameraId);
      await fs.rm(dir, { recursive: true, force: true });
      logger.info({ cameraId: parsed.data.cameraId }, "Gravações da câmera excluídas");
    } else {
      const entries = await fs.readdir(env.recordingsDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await fs.rm(path.join(env.recordingsDir, entry.name), { recursive: true, force: true });
        }
      }
      logger.info("Gravações de todas as câmeras excluídas");
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete recordings");
    res.status(500).json({ error: errorMessage(err) });
  }
});
