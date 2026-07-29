import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * The VLC relay (media/vlcRelay.ts) re-packages a camera's RTP into a new
 * RTSP stream, but doesn't always regenerate monotonically increasing
 * PTS/DTS while doing so - confirmed against a real deployment: MediaMTX's
 * HLS muxer can't tolerate a single out-of-order sample and destroys itself
 * the moment it hits one ("sample timestamp is impossible to handle",
 * alongside "[recorder] DTS is greater than PTS" on the same path), which
 * made the live HLS stream 500 every few seconds for every vlc-relay camera
 * (the muxer is permanently stuck in a create/destroy loop).
 *
 * This spawns an ffmpeg process that reads the relay's RTSP output,
 * discards its unreliable timestamps in favor of ones derived from the
 * local wall clock as each packet arrives, and PUBLISHES (pushes, same
 * pattern as rotationBridge.ts/mjpegBridge.ts) the result - stream-copied,
 * no transcode, so CPU cost stays negligible - to the camera's MediaMTX
 * path. `provisioning.ts` configures that path with `source: "publisher"`
 * whenever this bridge is in use (MediaMTX just waits for the bridge to
 * connect, instead of pulling from the relay itself).
 */

const RESPAWN_DELAY_MS = 3000;

interface BridgeHandle {
  process: ChildProcess;
  sourceUri: string;
  /** Set by stopTimestampBridge() before killing, so the exit handler knows not to auto-respawn. */
  stopping: boolean;
}

const activeBridges = new Map<string, BridgeHandle>();

/**
 * Ensures a timestamp-sanitizing bridge is running for this camera, reading
 * from `sourceUri` (the VLC relay's RTSP URL) and publishing to
 * `rtsp://<mediamtx>/<cameraId>`. Reuses an already-running bridge as-is if
 * it's alive and using the same source; otherwise the stale one is stopped
 * first and a fresh one started.
 */
export async function ensureTimestampBridge(cameraId: string, sourceUri: string): Promise<void> {
  const existing = activeBridges.get(cameraId);
  const alive = existing && existing.process.exitCode === null && !existing.process.killed;
  if (alive && existing.sourceUri === sourceUri) {
    return;
  }
  if (existing) {
    await stopTimestampBridge(cameraId);
  }

  const handle: BridgeHandle = { process: null as unknown as ChildProcess, sourceUri, stopping: false };
  activeBridges.set(cameraId, handle);
  spawnBridge(cameraId, handle);
}

function spawnBridge(cameraId: string, handle: BridgeHandle): void {
  const { sourceUri } = handle;
  logger.info({ cameraId }, "Starting timestamp-sanitizing bridge (ffmpeg, publishing to MediaMTX)");

  const child = spawn(
    env.ffmpegPath,
    [
      // The VLC relay's own RTSP output only serves over UDP (see
      // vlcRelay.ts/rotationBridge.ts - forcing TCP against it fails
      // immediately with "461 Unsupported transport").
      "-rtsp_transport",
      "udp",
      // Ignores the relay's own (unreliable) packet timestamps and assigns
      // fresh, monotonically increasing ones based on the local wall clock
      // instead - sidesteps the MediaMTX HLS-muxer crash entirely, without
      // needing a full re-encode.
      "-use_wallclock_as_timestamps",
      "1",
      "-i",
      sourceUri,
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
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
    logger.warn({ cameraId, code, signal }, "Timestamp bridge process exited");
    if (handle.stopping) {
      if (activeBridges.get(cameraId) === handle) {
        activeBridges.delete(cameraId);
      }
      return;
    }
    setTimeout(() => {
      if (activeBridges.get(cameraId) === handle) {
        spawnBridge(cameraId, handle);
      }
    }, RESPAWN_DELAY_MS);
  });
  child.on("error", (err) => {
    logger.error({ err, cameraId }, "Failed to start timestamp bridge process");
  });
}

/** Stops a camera's timestamp bridge, waiting for the process to fully exit before resolving. */
export function stopTimestampBridge(cameraId: string): Promise<void> {
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

export function stopAllTimestampBridges(): void {
  for (const cameraId of [...activeBridges.keys()]) {
    void stopTimestampBridge(cameraId);
  }
}
