import { Router } from "express";
import { getCameraById } from "../../db/cameras.repository.js";
import { listRecordingSegments } from "../../media/mediamtx.js";
import { errorMessage } from "../../lib/errors.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../lib/logger.js";

export const recordingsRouter = Router();

/**
 * Lists recorded segments for a camera within a time range, read directly
 * from MediaMTX's own Playback server (which indexes whatever it already
 * recorded to disk - see mediamtx.yml's `record`/`recordPath`). There's no
 * separate recordings database to keep in sync: MediaMTX is the source of
 * truth for what got recorded.
 *
 * `start`/`end` are optional ISO 8601 timestamps (RFC3339). Each returned
 * segment's `url` points back at this same backend (proxied via /recordings,
 * see app.ts) - never at MediaMTX's internal docker hostname directly.
 */
recordingsRouter.get("/:cameraId", async (req, res) => {
  const camera = getCameraById(req.params.cameraId);
  if (!camera) {
    res.status(404).json({ error: t("errors.cameraNotFound") });
    return;
  }

  const start = typeof req.query.start === "string" ? req.query.start : undefined;
  const end = typeof req.query.end === "string" ? req.query.end : undefined;

  try {
    const segments = await listRecordingSegments(camera.id, start, end);
    res.json(
      segments.map((segment) => ({
        start: segment.start,
        duration: segment.duration,
        url: `/recordings/get?path=${encodeURIComponent(camera.id)}&start=${encodeURIComponent(
          segment.start
        )}&duration=${encodeURIComponent(segment.duration)}`,
      }))
    );
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to list recording segments");
    res.status(502).json({ error: t("errors.recordingsListFailed"), details: errorMessage(err) });
  }
});
