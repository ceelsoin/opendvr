import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";
import { withRtspCredentials } from "../lib/rtsp.js";
import { logger } from "../lib/logger.js";
import type { Camera } from "../types/camera.js";

/**
 * Some cheap/OEM RTSP cameras only validate Digest authentication when the
 * authenticated retry arrives on the SAME TCP connection as the original 401
 * challenge - a behavior MediaMTX's Go RTSP client (gortsplib) doesn't
 * replicate (confirmed by isolated testing against a real camera), causing
 * "bad status code: 400 (Bad Request)" no matter what. VLC's live555-based
 * RTSP client handles this fine.
 *
 * This module spawns a headless VLC ("cvlc") process per affected camera
 * that pulls the stream once (as a real, working client) and re-serves it
 * as a brand new, unauthenticated RTSP stream on a local port. MediaMTX is
 * then configured to pull from THIS relay instead of talking to the picky
 * camera directly - it behaves like any other compliant RTSP source.
 *
 * Relay processes live for as long as the backend process does; they run in
 * the same container (which also has ffmpeg for the same kind of reason:
 * spawning battle-tested external tools instead of reimplementing protocol
 * quirks in Node). One process per camera, restarted on demand by
 * provisionCamera() (which calls ensureVlcRelay on every (re)provision).
 */

interface RelayHandle {
  process: ChildProcess;
  port: number;
  /** Set by stopVlcRelay() before killing, so the exit handler knows not to auto-respawn. */
  stopping: boolean;
}

const activeRelays = new Map<string, RelayHandle>();
let nextPort = env.vlcRelayPortStart;

const RESPAWN_DELAY_MS = 3000;

function allocatePort(): number {
  return nextPort++;
}

function relayUrl(port: number): string {
  return `rtsp://${env.vlcRelayHost}:${port}/relay`;
}

/**
 * Ensures a VLC relay is running for this camera, pulling from
 * `sourceRtspUri` (the camera's real, ONVIF-resolved RTSP URI, without
 * credentials - they're added here). Returns the relay's RTSP URL, which is
 * what should be used as the MediaMTX path's `source` instead of the
 * camera's direct URL.
 *
 * If a relay for this camera is already running, it's reused as-is (call
 * `stopVlcRelay` first if the source URI/credentials changed and a restart
 * is needed).
 *
 * The relay is self-healing: some cameras are flaky even for VLC (an
 * individual connection attempt can fail even with correct credentials -
 * confirmed against real hardware), so if the VLC process exits
 * unexpectedly (i.e. not via stopVlcRelay), it's automatically respawned
 * after a short delay, indefinitely, until the camera accepts a connection.
 */
export async function ensureVlcRelay(camera: Camera, sourceRtspUri: string): Promise<string> {
  const existing = activeRelays.get(camera.id);
  if (existing && existing.process.exitCode === null && !existing.process.killed) {
    return relayUrl(existing.port);
  }

  const port = allocatePort();
  const authenticatedSource = withRtspCredentials(sourceRtspUri, camera.username, camera.password);
  const handle: RelayHandle = { process: null as unknown as ChildProcess, port, stopping: false };
  activeRelays.set(camera.id, handle);

  spawnVlc(camera.id, authenticatedSource, handle);

  // Give VLC a moment to connect upstream and open its own RTSP listener
  // before MediaMTX tries to pull from it.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  return relayUrl(port);
}

function spawnVlc(cameraId: string, authenticatedSource: string, handle: RelayHandle): void {
  logger.info({ cameraId, port: handle.port }, "Starting VLC RTSP compatibility relay");

  const child = spawn(
    env.vlcPath,
    [
      "-vv",
      authenticatedSource,
      "--rtsp-tcp",
      // Generous TCP connection timeout so high-latency cameras (slow
      // embedded stacks, congested Wi-Fi, etc.) aren't cut off before they
      // get a chance to respond (VLC's default is much shorter).
      "--ipv4-timeout=60000",
      // Cameras here typically send G.711 (PCMA/PCMU) audio, which MediaMTX
      // doesn't support for HLS. Neither "--no-audio" (only disables local
      // playback output) nor "--audio-track=-1" (only affects demux track
      // selection) actually stop the audio ES from being duplicated into
      // the sout chain - confirmed empirically (still showed up in the
      // relay's own SDP with both). "--no-sout-audio" is the flag that
      // actually controls whether audio gets redirected into stream output.
      "--no-sout-audio",
      "--sout",
      `#rtp{sdp=rtsp://:${handle.port}/relay}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // VLC refuses to run as root; the Docker image creates a fixed-id
      // unprivileged user (uid/gid 10001) just for this. Only drop
      // privileges when actually running as root (production/Docker) - on
      // local dev (macOS/non-root) there's no such user and no permission
      // to setuid anyway, so skip it and let VLC run as the current user.
      ...(process.getuid?.() === 0 ? { uid: 10001, gid: 10001 } : {}),
      env: { ...process.env, HOME: "/tmp" },
    }
  );

  handle.process = child;

  child.stdout?.on("data", (chunk: Buffer) => {
    logger.debug({ cameraId }, chunk.toString("utf8").trim());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    logger.debug({ cameraId }, chunk.toString("utf8").trim());
  });
  child.on("exit", (code, signal) => {
    logger.warn({ cameraId, code, signal }, "VLC relay process exited");
    if (handle.stopping) {
      if (activeRelays.get(cameraId) === handle) {
        activeRelays.delete(cameraId);
      }
      return;
    }
    // Unexpected exit (camera rejected the connection, transient network
    // issue, etc.) - keep retrying indefinitely on the same port.
    setTimeout(() => {
      if (activeRelays.get(cameraId) === handle) {
        spawnVlc(cameraId, authenticatedSource, handle);
      }
    }, RESPAWN_DELAY_MS);
  });
  child.on("error", (err) => {
    logger.error({ err, cameraId }, "Failed to start VLC relay process");
  });
}

/** Returns the relay's RTSP URL for a camera if one is currently running, for display/diagnostic purposes. */
export function getVlcRelayUrl(cameraId: string): string | null {
  const handle = activeRelays.get(cameraId);
  return handle ? relayUrl(handle.port) : null;
}

/** Stops a camera's relay, waiting for the process to fully exit before resolving. */
export function stopVlcRelay(cameraId: string): Promise<void> {
  const handle = activeRelays.get(cameraId);
  if (!handle) return Promise.resolve();
  handle.stopping = true;
  activeRelays.delete(cameraId);

  if (!handle.process || handle.process.exitCode !== null || handle.process.killed) {
    return Promise.resolve();
  }

  // Wait for the process to actually terminate before resolving - callers
  // (provisionCamera on forceRefresh) rely on this to guarantee the old
  // process is fully gone before starting a new one. Without this, both
  // would briefly run at once, both trying to open an RTSP session against
  // the SAME camera - fatal for cameras that only support one concurrent
  // RTSP session (confirmed to cause persistent connection failures here).
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      handle.process.kill("SIGKILL");
      resolve();
    }, 5000);
    handle.process.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    handle.process.kill();
  });
}

export function stopAllVlcRelays(): void {
  for (const cameraId of [...activeRelays.keys()]) {
    void stopVlcRelay(cameraId);
  }
}

