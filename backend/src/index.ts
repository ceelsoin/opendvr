import { createServer } from "node:http";
import cron from "node-cron";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { runMigrations } from "./db/client.js";
import { listCameras } from "./db/cameras.repository.js";
import { initWebSocket } from "./ws/index.js";
import { stopAllRecordings } from "./media/recorder.js";
import { startMotionListening, shouldDetectMotion } from "./media/motionOrchestrator.js";
import { stopAllMotionDetectors } from "./media/motionDetector.js";
import { provisionCamera } from "./media/provisioning.js";
import { getCameraPathStatus } from "./media/mediamtx.js";
import { stopAllVlcRelays } from "./media/vlcRelay.js";
import { runRetentionCleanup } from "./jobs/retentionCleanup.js";
import { logger } from "./lib/logger.js";

runMigrations();

const app = createApp();
const httpServer = createServer(app);
initWebSocket(httpServer);

httpServer.listen(env.port, () => {
  logger.info(`OpenDVR backend listening on http://localhost:${env.port}`);
});

// MediaMTX paths only exist in-memory (registered via its Control API), so
// they're lost whenever the MediaMTX container/process restarts - even if
// the backend itself didn't. Re-provision every stored camera on boot so
// streams/recording resume without the user having to manually hit
// "Reiniciar" on each camera after any restart.
for (const camera of listCameras()) {
  void provisionCamera(camera);
  if (shouldDetectMotion(camera)) {
    void startMotionListening(camera);
  }
}

// Also guard against MediaMTX restarting on its own (crash/OOM) while the
// backend keeps running: periodically check whether each camera's path is
// still configured, and re-provision it if MediaMTX forgot about it.
// Additionally, self-heal cameras that are configured but stuck not-ready
// for too long (e.g. a VLC relay process that's alive but hung talking to a
// flaky camera - re-registering the path alone doesn't fix that, since the
// path was never missing in the first place; only a forced reprovision
// (which kills and restarts the VLC relay) does).
const RECONCILE_INTERVAL_MS = 60_000;
const STUCK_READY_THRESHOLD_MS = 3 * 60_000;
const notReadySince = new Map<string, number>();

setInterval(() => {
  for (const camera of listCameras()) {
    void getCameraPathStatus(camera.id).then((status) => {
      if (!status.configured) {
        logger.warn({ cameraId: camera.id }, "MediaMTX path missing (likely restarted); re-provisioning");
        notReadySince.delete(camera.id);
        void provisionCamera(camera);
        return;
      }

      // Every camera path is now always-connected (sourceOnDemand: false, see
      // media/provisioning.ts), so "configured but not ready" is always a
      // real problem worth self-healing, regardless of continuousRecording
      // or whether anyone is currently watching.
      if (status.ready) {
        notReadySince.delete(camera.id);
        return;
      }

      const stuckSince = notReadySince.get(camera.id) ?? Date.now();
      notReadySince.set(camera.id, stuckSince);
      if (Date.now() - stuckSince >= STUCK_READY_THRESHOLD_MS) {
        logger.warn(
          { cameraId: camera.id, stuckForMs: Date.now() - stuckSince },
          "Camera stream stuck (configured but not ready for too long); forcing full reprovision"
        );
        notReadySince.delete(camera.id);
        void provisionCamera(camera, { forceRefresh: true });
      }
    });
  }
}, RECONCILE_INTERVAL_MS).unref();

// Daily retention cleanup: deletes event rows + snapshot files older than
// each camera's own `retentionDays` (recorded video clips are handled
// natively by MediaMTX instead - see media/provisioning.ts's
// `recordDeleteAfter`). Runs on a daily schedule, plus once shortly after
// boot so a server that isn't up at 03:00 every day still gets cleaned up.
cron.schedule("0 3 * * *", () => void runRetentionCleanup(), { unref: true });
setTimeout(() => void runRetentionCleanup(), 60_000).unref();

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully");
  stopAllRecordings();
  stopAllVlcRelays();
  stopAllMotionDetectors();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
