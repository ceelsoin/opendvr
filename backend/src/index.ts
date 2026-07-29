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
import { stopAllMjpegBridges } from "./media/mjpegBridge.js";
import { stopAllWebpageBridges } from "./media/webpageBridge.js";
import { stopAllRotationBridges } from "./media/rotationBridge.js";
import { runRetentionCleanup } from "./jobs/retentionCleanup.js";
import { warmPtzConnection, PTZ_CONNECTION_TTL_MS } from "./onvif/ptz.js";
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
  if (!camera.enabled) continue;
  void provisionCamera(camera);
  if (shouldDetectMotion(camera)) {
    void startMotionListening(camera);
  }
  if (camera.hasPtz) {
    void warmPtzConnection(camera);
  }
}

// Cameras' PTZ connections (see onvif/ptz.ts) are cached for
// PTZ_CONNECTION_TTL_MS to avoid paying a full ONVIF reconnect (~10-25s on
// these fragile OEM cameras) on every button press - but that only helps
// once *something* has warmed the cache. Proactively refreshing it on a
// recurring basis (comfortably before it expires) means a user's first PTZ
// command of the day/session is fast too, instead of eating that cost live
// the first time they actually try to move the camera.
const PTZ_WARMUP_INTERVAL_MS = PTZ_CONNECTION_TTL_MS - 60_000;
setInterval(() => {
  for (const camera of listCameras()) {
    if (!camera.enabled || !camera.hasPtz) continue;
    void warmPtzConnection(camera);
  }
}, PTZ_WARMUP_INTERVAL_MS).unref();

// Also guard against MediaMTX restarting on its own (crash/OOM) while the
// backend keeps running: periodically check whether each camera's path is
// still configured, and re-provision it if MediaMTX forgot about it.
// Additionally, self-heal cameras that are stuck unhealthy for too long -
// either "configured but not ready", OR (the sneakier case) "ready" per
// MediaMTX but with zero new bytes since the last check. That second case
// matters specifically for VLC-relay cameras (see media/vlcRelay.ts): VLC's
// own RTSP-output module can wedge itself (process stays alive - never
// exits, so the relay's own exit-triggered respawn never fires - but stops
// actually relaying frames) while MediaMTX still reports the path as
// "ready" for a while (its own readTimeout is a generous 120s, see
// mediamtx.yml), which "ready" alone doesn't catch. Only a forced
// reprovision (which kills and restarts the VLC relay) fixes either case.
const RECONCILE_INTERVAL_MS = 30_000;
const STUCK_THRESHOLD_MS = 90_000;
const unhealthySince = new Map<string, number>();
const lastBytesReceived = new Map<string, number>();

setInterval(() => {
  for (const camera of listCameras()) {
    if (!camera.enabled) continue;
    void getCameraPathStatus(camera.id).then((status) => {
      if (!status.configured) {
        logger.warn({ cameraId: camera.id }, "MediaMTX path missing (likely restarted); re-provisioning");
        unhealthySince.delete(camera.id);
        lastBytesReceived.delete(camera.id);
        void provisionCamera(camera);
        return;
      }

      // "Flowing" requires BOTH ready AND actual byte progress since the
      // last check (30s ago) - not just ready, which a wedged VLC relay can
      // keep reporting true for a while with no new frames ever arriving.
      // On the very first check for a camera (no previous byte count yet),
      // ready alone is treated as healthy to avoid a false positive.
      const previousBytes = lastBytesReceived.get(camera.id);
      const isFlowing = status.ready && (previousBytes === undefined || status.bytesReceived > previousBytes);
      lastBytesReceived.set(camera.id, status.bytesReceived);

      if (isFlowing) {
        unhealthySince.delete(camera.id);
        return;
      }

      const stuckSince = unhealthySince.get(camera.id) ?? Date.now();
      unhealthySince.set(camera.id, stuckSince);
      if (Date.now() - stuckSince >= STUCK_THRESHOLD_MS) {
        logger.warn(
          { cameraId: camera.id, stuckForMs: Date.now() - stuckSince, ready: status.ready, bytesReceived: status.bytesReceived },
          "Camera stream stuck (not ready, or ready but no new bytes) for too long; forcing full reprovision"
        );
        unhealthySince.delete(camera.id);
        lastBytesReceived.delete(camera.id);
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
  stopAllMjpegBridges();
  void stopAllWebpageBridges();
  stopAllRotationBridges();
  stopAllMotionDetectors();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
