import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright-core";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Bridges an arbitrary web page (rendered by a headless Chromium, see
 * Dockerfile) into MediaMTX by having ffmpeg PUBLISH (push) directly to the
 * camera's own MediaMTX path - the "webpage" camera source type.
 * provisioning.ts configures that path with `source: "publisher"` so
 * MediaMTX just waits for this process to connect. There's no way to make
 * ffmpeg render HTML/CSS/JS itself, so a real browser engine is
 * unavoidable here; this is by far the heaviest source type in the app
 * (see Dockerfile comment).
 *
 * (Earlier iteration tried to make ffmpeg act as its own tiny pull-able
 * RTSP server via `-rtsp_flags listen` - confirmed via direct testing that
 * ffmpeg's RTSP muxer in this build has no such listen/server option at
 * all. Push mode - see media/mjpegBridge.ts for the same finding - avoids
 * the problem entirely and needs no port allocation/relay URL.)
 *
 * Approach: one shared headless Chromium instance for the whole process
 * (each camera gets its own Page, not its own browser - a full browser
 * process per camera would be needlessly expensive), screenshotting its
 * page on an interval and piping the JPEG frames into an ffmpeg process via
 * stdin (`-f image2pipe`), which encodes to H.264 and publishes to
 * `rtsp://<mediamtx>/<cameraId>`.
 */

const RESPAWN_DELAY_MS = 5000;
const CAPTURE_FPS = 2;
const VIEWPORT = { width: 1280, height: 720 };

interface BridgeHandle {
  page: Page;
  ffmpeg: ChildProcess;
  captureTimer: NodeJS.Timeout;
  stopping: boolean;
}

const activeBridges = new Map<string, BridgeHandle>();
let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;

async function getSharedBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium
      .launch({
        executablePath: env.chromiumPath,
        headless: true,
        // Required to run Chromium as root in a container without a real
        // sandbox namespace set up for it (same flags used by most
        // headless-Chromium-in-Docker setups); --disable-dev-shm-usage
        // avoids crashes from Docker's small default /dev/shm size.
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      })
      .then((browser) => {
        sharedBrowser = browser;
        return browser;
      });
  }
  return sharedBrowserPromise;
}

/**
 * Ensures a webpage-capture bridge is running for this camera, navigating
 * to `pageUrl` and publishing the capture to `rtsp://<mediamtx>/<cameraId>`.
 * Reuses an already-running bridge as-is if present.
 */
export async function ensureWebpageBridge(cameraId: string, pageUrl: string): Promise<void> {
  const existing = activeBridges.get(cameraId);
  if (existing && existing.ffmpeg.exitCode === null && !existing.ffmpeg.killed) {
    return;
  }

  const browser = await getSharedBrowser();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30_000 }).catch((err) => {
    logger.warn({ err, cameraId, pageUrl }, "Webpage bridge: initial page load failed/timed out, continuing anyway");
  });

  const handle: BridgeHandle = {
    page,
    ffmpeg: null as unknown as ChildProcess,
    captureTimer: null as unknown as NodeJS.Timeout,
    stopping: false,
  };
  activeBridges.set(cameraId, handle);

  spawnBridge(cameraId, handle);
}

function spawnFfmpeg(cameraId: string): ChildProcess {
  logger.info({ cameraId }, "Starting webpage-capture bridge (Chromium + ffmpeg, publishing to MediaMTX)");
  return spawn(
    env.ffmpegPath,
    [
      "-f",
      "image2pipe",
      "-framerate",
      String(CAPTURE_FPS),
      "-c:v",
      "mjpeg",
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-f",
      "rtsp",
      "-rtsp_transport",
      "tcp",
      `${env.mediamtxRtspUrl}/${cameraId}`,
    ],
    { stdio: ["pipe", "ignore", "pipe"] }
  );
}

function spawnBridge(cameraId: string, handle: BridgeHandle): void {
  const ffmpeg = spawnFfmpeg(cameraId);
  handle.ffmpeg = ffmpeg;

  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    logger.debug({ cameraId }, chunk.toString("utf8").trim());
  });
  ffmpeg.on("exit", (code, signal) => {
    logger.warn({ cameraId, code, signal }, "Webpage bridge's ffmpeg process exited");
    clearInterval(handle.captureTimer);
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
  ffmpeg.on("error", (err) => {
    logger.error({ err, cameraId }, "Failed to start webpage bridge's ffmpeg process");
  });

  handle.captureTimer = setInterval(() => {
    void handle.page
      .screenshot({ type: "jpeg", quality: 80 })
      .then((buffer) => {
        // stdin can be null/closed if ffmpeg already exited between the
        // interval firing and the screenshot resolving - guard against
        // writing to a dead pipe (would throw EPIPE).
        if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
          ffmpeg.stdin.write(buffer);
        }
      })
      .catch((err) => {
        logger.debug({ err, cameraId }, "Webpage bridge: screenshot failed, skipping this frame");
      });
  }, 1000 / CAPTURE_FPS);
}

/** Stops a camera's bridge (ffmpeg process + its Chromium page), waiting for the process to fully exit before resolving. */
export async function stopWebpageBridge(cameraId: string): Promise<void> {
  const handle = activeBridges.get(cameraId);
  if (!handle) return;
  handle.stopping = true;
  activeBridges.delete(cameraId);
  clearInterval(handle.captureTimer);

  await handle.page.close().catch(() => undefined);

  if (!handle.ffmpeg || handle.ffmpeg.exitCode !== null || handle.ffmpeg.killed) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      handle.ffmpeg.kill("SIGKILL");
      resolve();
    }, 5000);
    handle.ffmpeg.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    handle.ffmpeg.kill("SIGTERM");
  });
}

export async function stopAllWebpageBridges(): Promise<void> {
  await Promise.all([...activeBridges.keys()].map((cameraId) => stopWebpageBridge(cameraId)));
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
    sharedBrowser = null;
    sharedBrowserPromise = null;
  }
}
