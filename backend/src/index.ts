import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import fs from "node:fs";
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
import { applyStreamSettingsToMediaMtx } from "./media/streamSettings.js";
import { stopAllVlcRelays } from "./media/vlcRelay.js";
import { stopAllMjpegBridges } from "./media/mjpegBridge.js";
import { stopAllWebpageBridges } from "./media/webpageBridge.js";
import { stopAllRotationBridges } from "./media/rotationBridge.js";
import { stopAllTimestampBridges } from "./media/timestampBridge.js";
import { runRetentionCleanup } from "./jobs/retentionCleanup.js";
import { warmPtzConnection, PTZ_CONNECTION_TTL_MS } from "./onvif/ptz.js";
import { notifyCameraUnavailable, notifyCameraRecovered } from "./notifications/webhooks.js";
import { logger } from "./lib/logger.js";

runMigrations();

const app = createApp();
const httpServer = createServer(app);
initWebSocket(httpServer);

httpServer.listen(env.port, () => {
  logger.info(`OpenDVR backend listening on http://localhost:${env.port}`);
});

// Optional second listener, over HTTPS, for browsers to unlock the Push
// API/Service Workers (only available in a "secure context" - HTTPS or
// localhost - see config/env.ts's httpsCertFile/httpsKeyFile doc comment).
// Fully opt-in: only starts if BOTH files are set AND actually readable: a
// misconfigured path (typo, forgot to mount the volume, etc) just skips
// this with a warning instead of crashing the whole app on boot.
let httpsServer: ReturnType<typeof createHttpsServer> | undefined;
if (env.httpsCertFile && env.httpsKeyFile) {
  try {
    const key = fs.readFileSync(env.httpsKeyFile);
    const cert = fs.readFileSync(env.httpsCertFile);
    httpsServer = createHttpsServer({ key, cert }, app);
    initWebSocket(httpsServer);
    httpsServer.listen(env.httpsPort, () => {
      logger.info(`OpenDVR backend also listening on https://localhost:${env.httpsPort}`);
    });
  } catch (err) {
    logger.warn(
      { err, certFile: env.httpsCertFile, keyFile: env.httpsKeyFile },
      "HTTPS_CERT_FILE/HTTPS_KEY_FILE are set but couldn't be read - skipping the local HTTPS listener (HTTP still works normally)"
    );
  }
}

// MediaMTX paths - AND its global HLS config, see media/streamSettings.ts -
// only exist in-memory (set via its Control API), so they're lost whenever
// the MediaMTX container/process restarts - even if the backend itself
// didn't. Re-apply both on boot so streams/recording and any saved HLS
// tuning resume without the user having to manually hit "Reiniciar".
void applyStreamSettingsToMediaMtx();
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
// Checked/retried fairly aggressively (every 15s, forcing a reprovision
// after only 45s stuck) so a flaky camera reconnects quickly instead of
// staying dark for minutes.
const RECONCILE_INTERVAL_MS = 15_000;
const STUCK_THRESHOLD_MS = 45_000;
const unhealthySince = new Map<string, number>();
const lastBytesReceived = new Map<string, number>();

// Separate, longer-horizon tracking for external notifications: how long a
// camera has been continuously unavailable (independent of the forced
// reprovision attempts above, which reset `unhealthySince` on every retry -
// this map is only cleared once the camera is actually flowing again), and
// when it was last notified about, so a prolonged outage gets a first
// alert at the 10-minute mark and then a reminder every hour instead of
// either silence or a flood of pings.
const UNAVAILABLE_NOTIFY_THRESHOLD_MS = 10 * 60_000;
const UNAVAILABLE_NOTIFY_REPEAT_MS = 60 * 60_000;
const downSince = new Map<string, number>();
const lastUnavailableNotifiedAt = new Map<string, number>();

setInterval(() => {
  for (const camera of listCameras()) {
    if (!camera.enabled) continue;
    void getCameraPathStatus(camera.id).then((status) => {
      if (!status.configured) {
        logger.warn({ cameraId: camera.id }, "MediaMTX path missing (likely restarted); re-provisioning");
        unhealthySince.delete(camera.id);
        lastBytesReceived.delete(camera.id);
        void provisionCamera(camera);
      } else {
        // "Flowing" requires BOTH ready AND actual byte progress since the
        // last check - not just ready, which a wedged VLC relay can keep
        // reporting true for a while with no new frames ever arriving. On
        // the very first check for a camera (no previous byte count yet),
        // ready alone is treated as healthy to avoid a false positive.
        const previousBytes = lastBytesReceived.get(camera.id);
        const isFlowing = status.ready && (previousBytes === undefined || status.bytesReceived > previousBytes);
        lastBytesReceived.set(camera.id, status.bytesReceived);

        if (isFlowing) {
          unhealthySince.delete(camera.id);
        } else {
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
        }

        // Longer-horizon connectivity tracking, for external notifications
        // (Discord/Telegram/webhook/email) - independent of the forced
        // reprovision logic above.
        if (isFlowing) {
          const since = downSince.get(camera.id);
          const wasNotified = lastUnavailableNotifiedAt.has(camera.id);
          downSince.delete(camera.id);
          lastUnavailableNotifiedAt.delete(camera.id);
          if (since !== undefined && wasNotified) {
            void notifyCameraRecovered(camera, Date.now() - since).catch((err) => {
              logger.warn({ err, cameraId: camera.id }, "Failed to send camera-recovered notification");
            });
          }
        } else {
          const since = downSince.get(camera.id) ?? Date.now();
          downSince.set(camera.id, since);
          const downForMs = Date.now() - since;
          const lastNotifiedAt = lastUnavailableNotifiedAt.get(camera.id);
          if (
            downForMs >= UNAVAILABLE_NOTIFY_THRESHOLD_MS &&
            (lastNotifiedAt === undefined || Date.now() - lastNotifiedAt >= UNAVAILABLE_NOTIFY_REPEAT_MS)
          ) {
            lastUnavailableNotifiedAt.set(camera.id, Date.now());
            void notifyCameraUnavailable(camera, since).catch((err) => {
              logger.warn({ err, cameraId: camera.id }, "Failed to send camera-unavailable notification");
            });
          }
        }
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
  stopAllTimestampBridges();
  stopAllMotionDetectors();
  httpsServer?.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
