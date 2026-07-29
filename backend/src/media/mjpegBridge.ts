import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Bridges an MJPEG-over-HTTP camera (`multipart/x-mixed-replace`, common on
 * cheap/old webcams that don't speak RTSP at all) into MediaMTX by having
 * ffmpeg PUBLISH (push) directly to the camera's own MediaMTX path -
 * provisioning.ts configures that path with `source: "publisher"` so
 * MediaMTX just waits for this process to connect, instead of trying to
 * pull from anywhere.
 *
 * (Earlier iteration tried to make ffmpeg act as its own tiny pull-able
 * RTSP server via `-rtsp_flags listen`, mirroring media/vlcRelay.ts's VLC
 * `--sout` trick - confirmed via direct testing that ffmpeg's RTSP MUXER in
 * this build has no such listen/server option at all (only
 * `-rtsp_transport` for outbound push; the equivalent listen flag only
 * exists for the HTTP muxer). Push mode avoids the whole problem AND is
 * simpler: no port allocation, no separate relay URL - MediaMTX's own
 * `publisher` source type is designed for exactly this.)
 *
 * ffmpeg re-encodes to H.264 (MJPEG cameras only produce a sequence of
 * JPEGs, no video codec at all).
 */

const RESPAWN_DELAY_MS = 3000;

interface BridgeHandle {
  process: ChildProcess;
  /** Set by stopMjpegBridge() before killing, so the exit handler knows not to auto-respawn. */
  stopping: boolean;
}

const activeBridges = new Map<string, BridgeHandle>();

/**
 * Ensures an ffmpeg bridge is running for this camera, reading from
 * `mjpegUrl` (the camera's MJPEG HTTP URL, credentials embedded in the URL
 * if needed) and publishing to `rtsp://<mediamtx>/<cameraId>`. Reuses an
 * already-running bridge as-is if present.
 */
export function ensureMjpegBridge(cameraId: string, mjpegUrl: string): void {
  const existing = activeBridges.get(cameraId);
  if (existing && existing.process.exitCode === null && !existing.process.killed) {
    return;
  }

  const handle: BridgeHandle = { process: null as unknown as ChildProcess, stopping: false };
  activeBridges.set(cameraId, handle);
  spawnBridge(cameraId, mjpegUrl, handle);
}

function spawnBridge(cameraId: string, mjpegUrl: string, handle: BridgeHandle): void {
  logger.info({ cameraId }, "Starting MJPEG-over-HTTP bridge (ffmpeg, publishing to MediaMTX)");

  const child = spawn(
    env.ffmpegPath,
    [
      "-i",
      mjpegUrl,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      // MJPEG frames are typically full-range yuvj420p, which some
      // decoders/HLS pipelines warn about (or reject) - normalize to
      // standard-range yuv420p.
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-f",
      "rtsp",
      "-rtsp_transport",
      "tcp",
      `${env.mediamtxRtspUrl}/${cameraId}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  handle.process = child;

  child.stderr?.on("data", (chunk: Buffer) => {
    logger.debug({ cameraId }, chunk.toString("utf8").trim());
  });
  child.on("exit", (code, signal) => {
    logger.warn({ cameraId, code, signal }, "MJPEG bridge process exited");
    if (handle.stopping) {
      if (activeBridges.get(cameraId) === handle) {
        activeBridges.delete(cameraId);
      }
      return;
    }
    setTimeout(() => {
      if (activeBridges.get(cameraId) === handle) {
        spawnBridge(cameraId, mjpegUrl, handle);
      }
    }, RESPAWN_DELAY_MS);
  });
  child.on("error", (err) => {
    logger.error({ err, cameraId }, "Failed to start MJPEG bridge process");
  });
}

/** Stops a camera's bridge, waiting for the process to fully exit before resolving. */
export function stopMjpegBridge(cameraId: string): Promise<void> {
  const handle = activeBridges.get(cameraId);
  if (!handle) return Promise.resolve();
  handle.stopping = true;
  activeBridges.delete(cameraId);

  if (!handle.process || handle.process.exitCode !== null || handle.process.killed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      handle.process.kill("SIGKILL");
      resolve();
    }, 5000);
    handle.process.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    handle.process.kill("SIGTERM");
  });
}

export function stopAllMjpegBridges(): void {
  for (const cameraId of [...activeBridges.keys()]) {
    void stopMjpegBridge(cameraId);
  }
}
