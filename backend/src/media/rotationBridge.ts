import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { CameraRotation } from "../types/camera.js";

/**
 * Rotates a camera's video before it reaches MediaMTX, for cameras mounted
 * in a physical orientation other than upright (e.g. sideways or upside
 * down). MediaMTX itself is a pure media server/relay - it has no
 * transcoding or video-filter capability at all, so rotation can only
 * happen by decoding, applying a filter, and re-encoding somewhere in
 * front of it. This spawns an ffmpeg process that reads from whatever
 * source URI the camera would otherwise have used directly (a plain RTSP
 * URL, an ONVIF-resolved RTSP URI, a VLC-relay URL, or an RTMP/HLS/SRT
 * URL - anything ffmpeg can demux), applies the rotation filter, and
 * PUBLISHES (pushes) the result to the camera's own MediaMTX path -
 * provisioning.ts configures that path with `source: "publisher"` whenever
 * rotation is enabled, same push-mode pattern as media/mjpegBridge.ts and
 * media/webpageBridge.ts (MediaMTX just waits for this process to connect,
 * instead of pulling from anywhere itself).
 *
 * Only used for "onvif"/"rtsp"/"rtmp"/"hls"/"srt" source types. The
 * "mjpeg-http" and "webpage" source types already run their own ffmpeg
 * transcode (they have no choice - neither speaks RTSP/a video codec
 * natively), so rotation for those is applied directly to their existing
 * ffmpeg invocation instead of adding a second bridge/transcode pass here.
 */

const RESPAWN_DELAY_MS = 3000;

interface BridgeHandle {
  process: ChildProcess;
  sourceUri: string;
  rotation: Exclude<CameraRotation, 0>;
  inputTransport: "tcp" | "udp";
  /** Set by stopRotationBridge() before killing, so the exit handler knows not to auto-respawn. */
  stopping: boolean;
}

const activeBridges = new Map<string, BridgeHandle>();

/** ffmpeg `-vf` value for each supported rotation amount (clockwise). */
export function rotationFilter(rotation: Exclude<CameraRotation, 0>): string {
  switch (rotation) {
    case 90:
      return "transpose=1";
    case 180:
      return "transpose=2,transpose=2";
    case 270:
      return "transpose=2";
  }
}

/**
 * Ensures a rotation bridge is running for this camera, reading from
 * `sourceUri` and publishing the rotated result to
 * `rtsp://<mediamtx>/<cameraId>`. Reuses an already-running bridge as-is if
 * it's alive AND already using the same source/rotation; otherwise (source
 * URI changed, rotation amount changed, or the process died) the stale one
 * is stopped first and a fresh one started, so config changes actually take
 * effect instead of silently keeping the old stream running.
 */
export async function ensureRotationBridge(
  cameraId: string,
  sourceUri: string,
  rotation: Exclude<CameraRotation, 0>,
  inputTransport: "tcp" | "udp" = "tcp"
): Promise<void> {
  const existing = activeBridges.get(cameraId);
  const alive = existing && existing.process.exitCode === null && !existing.process.killed;
  if (alive && existing.sourceUri === sourceUri && existing.rotation === rotation && existing.inputTransport === inputTransport) {
    return;
  }
  if (existing) {
    await stopRotationBridge(cameraId);
  }

  const handle: BridgeHandle = { process: null as unknown as ChildProcess, sourceUri, rotation, inputTransport, stopping: false };
  activeBridges.set(cameraId, handle);
  spawnBridge(cameraId, handle);
}

function spawnBridge(cameraId: string, handle: BridgeHandle): void {
  const { sourceUri, rotation, inputTransport } = handle;
  logger.info({ cameraId, rotation, inputTransport }, "Starting PTZ rotation bridge (ffmpeg, publishing to MediaMTX)");

  const isRtsp = sourceUri.startsWith("rtsp://");
  const child = spawn(
    env.ffmpegPath,
    [
      // The VLC-relay compatibility path (media/vlcRelay.ts) only serves its
      // own RTSP output over UDP - forcing TCP against it fails immediately
      // with "461 Unsupported transport" (confirmed: this is exactly what
      // caused rotated cameras using vlc-relay to crash-loop and go
      // offline). Plain RTSP sources (direct camera/ONVIF, no relay) use TCP
      // as usual for reliability.
      ...(isRtsp ? ["-rtsp_transport", inputTransport] : []),
      "-i",
      sourceUri,
      "-vf",
      rotationFilter(rotation),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      // Re-encode audio too (if the source has any) instead of dropping it -
      // rotation only needs to touch video, but the output container/timing
      // changed enough (new encode, new keyframes) that a plain "copy"
      // isn't reliable; ffmpeg simply skips this if there's no audio stream.
      "-c:a",
      "aac",
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
    logger.warn({ cameraId, code, signal }, "Rotation bridge process exited");
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
    logger.error({ err, cameraId }, "Failed to start rotation bridge process");
  });
}

/** Stops a camera's rotation bridge, waiting for the process to fully exit before resolving. */
export function stopRotationBridge(cameraId: string): Promise<void> {
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

export function stopAllRotationBridges(): void {
  for (const cameraId of [...activeBridges.keys()]) {
    void stopRotationBridge(cameraId);
  }
}
