import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { CameraRotation, TranscodeResolution } from "../types/camera.js";

/**
 * Transcodes a camera's video before it reaches MediaMTX, for two
 * independent reasons that share the same ffmpeg pipeline: (1) rotation,
 * for cameras mounted in a physical orientation other than upright, and
 * (2) a per-camera "force H.264" override, for cameras whose actual codec
 * (typically H.265/HEVC) some clients can't decode (open-source Chromium
 * builds have no licensed HEVC decoder at all, regardless of hardware).
 * MediaMTX itself is a pure media server/relay - it has no transcoding or
 * video-filter capability at all, so either of these requires decoding,
 * optionally filtering, and re-encoding somewhere in front of it. This
 * spawns an ffmpeg process that reads from whatever source URI the camera
 * would otherwise have used directly (a plain RTSP URL, an ONVIF-resolved
 * RTSP URI, a VLC-relay URL, or an RTMP/HLS/SRT URL - anything ffmpeg can
 * demux), applies the rotation filter and/or a resolution downscale if
 * configured, and PUBLISHES (pushes) the result to the camera's own
 * MediaMTX path - provisioning.ts configures that path with
 * `source: "publisher"` whenever this bridge is enabled, same push-mode
 * pattern as media/mjpegBridge.ts and media/webpageBridge.ts (MediaMTX just
 * waits for this process to connect, instead of pulling from anywhere
 * itself). Re-encoding also happens to produce fresh, monotonic
 * timestamps, so this bridge doubles as a replacement for
 * media/timestampBridge.ts whenever it runs (see provisioning.ts).
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
  rotation: CameraRotation;
  resolution: TranscodeResolution;
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

/** ffmpeg `-vf` value for a downscale, keeping aspect ratio (`-2` rounds width to an even number). Null for "original" (no scaling). */
export function scaleFilter(resolution: TranscodeResolution): string | null {
  return resolution === "original" ? null : `scale=-2:${resolution}`;
}

/** Combines the rotation and scale filters into a single `-vf` value, or null if neither applies. */
export function buildVideoFilter(rotation: CameraRotation, resolution: TranscodeResolution): string | null {
  const filters = [rotation !== 0 ? rotationFilter(rotation) : null, scaleFilter(resolution)].filter(
    (f): f is string => f !== null
  );
  return filters.length > 0 ? filters.join(",") : null;
}

/**
 * Ensures a transcode bridge is running for this camera, reading from
 * `sourceUri` and publishing the (rotated/rescaled/re-encoded) result to
 * `rtsp://<mediamtx>/<cameraId>`. Reuses an already-running bridge as-is if
 * it's alive AND already using the same source/rotation/resolution;
 * otherwise (any of those changed, or the process died) the stale one is
 * stopped first and a fresh one started, so config changes actually take
 * effect instead of silently keeping the old stream running.
 *
 * `force` bypasses the "already alive with the same config" reuse check -
 * needed because a stalled/flaky source can leave ffmpeg alive (not
 * exited) but no longer actually receiving frames, with everything else
 * (sourceUri, rotation, resolution) unchanged. The reconciliation loop in
 * index.ts detects that case (path "ready" but no new bytes for a while)
 * and calls `provisionCamera(camera, { forceRefresh: true })` specifically
 * to recover from it - without `force`, this function would just see
 * "already alive, same config" and do nothing, leaving the camera stuck
 * dark indefinitely (the bug this parameter fixes).
 */
export async function ensureRotationBridge(
  cameraId: string,
  sourceUri: string,
  rotation: CameraRotation,
  resolution: TranscodeResolution = "original",
  inputTransport: "tcp" | "udp" = "tcp",
  force = false
): Promise<void> {
  const existing = activeBridges.get(cameraId);
  const alive = existing && existing.process.exitCode === null && !existing.process.killed;
  if (
    !force &&
    alive &&
    existing.sourceUri === sourceUri &&
    existing.rotation === rotation &&
    existing.resolution === resolution &&
    existing.inputTransport === inputTransport
  ) {
    return;
  }
  if (existing) {
    await stopRotationBridge(cameraId);
  }

  const handle: BridgeHandle = {
    process: null as unknown as ChildProcess,
    sourceUri,
    rotation,
    resolution,
    inputTransport,
    stopping: false,
  };
  activeBridges.set(cameraId, handle);
  spawnBridge(cameraId, handle);
}

function spawnBridge(cameraId: string, handle: BridgeHandle): void {
  const { sourceUri, rotation, resolution, inputTransport } = handle;
  logger.info({ cameraId, rotation, resolution, inputTransport }, "Starting transcode bridge (ffmpeg, publishing to MediaMTX)");

  const videoFilter = buildVideoFilter(rotation, resolution);
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
      // Bounds how long ffmpeg will block waiting for data on a stalled/
      // flaky connection (microseconds) - without this, a source that goes
      // quiet without cleanly closing the TCP connection can leave ffmpeg
      // stuck reading forever, never exiting, so the respawn-on-exit logic
      // below never fires. 15s comfortably tolerates brief instability
      // while still recovering from a genuinely dead connection quickly.
      ...(isRtsp ? ["-timeout", "15000000"] : []),
      "-i",
      sourceUri,
      ...(videoFilter ? ["-vf", videoFilter] : []),
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
    logger.warn({ cameraId, code, signal }, "Transcode bridge process exited");
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
    logger.error({ err, cameraId }, "Failed to start transcode bridge process");
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
