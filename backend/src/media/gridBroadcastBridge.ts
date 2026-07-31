import { spawn, type ChildProcess } from "node:child_process";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { getCameraById } from "../db/cameras.repository.js";
import { deleteCameraPath, subStreamPathName, upsertCameraPath } from "./mediamtx.js";
import type { Camera } from "../types/camera.js";
import type { Grid } from "../types/grid.js";

/**
 * Optional single-stream broadcast for a grid (see types/grid.ts's
 * `GridBroadcastMode` doc comment) - a dumb client (VLC, a smart TV, an
 * Orange Pi) points at one HLS URL and leaves it playing, no session/login
 * involved. Two flavors, both implemented as an ffmpeg process PUBLISHING
 * (pushing) into a dedicated MediaMTX path `grid_<gridId>`, same
 * push-mode pattern as media/rotationBridge.ts/mjpegBridge.ts:
 *  - "mosaic": one long-running ffmpeg reads every camera at once and
 *    combines them into a single frame via `xstack` (layout follows the
 *    grid's own `columns`).
 *  - "rotation": a timer swaps the ffmpeg process's single input every
 *    `broadcastIntervalSeconds`, cycling through the grid's cameras one at
 *    a time.
 * Reads each camera from MediaMTX's OWN already-provisioned RTSP path
 * (`rtsp://mediamtx:8554/<cameraId>`, or `<cameraId>_sub` when available -
 * see sourceUrlFor) rather than re-deriving ONVIF/vlc-relay sourcing here -
 * that's already handled by media/provisioning.ts, so this stays decoupled
 * from any camera-specific quirks.
 */

const RESPAWN_DELAY_MS = 3000;
// Bounds how long ffmpeg blocks reading a stalled camera path (microseconds,
// see rotationBridge.ts for why this matters).
const READ_TIMEOUT_US = "15000000";
const TILE_WIDTH = 640;
const TILE_HEIGHT = 360;

function sourcePathFor(camera: Camera): string {
  // Prefer the lighter sub-stream when available - a broadcast may be
  // decoding every camera in the grid at once (mosaic) or back-to-back
  // (rotation), so keeping per-camera cost low matters even more here than
  // in CameraTile.tsx's grid-tile preference. Same eligibility rule as
  // media/provisioning.ts's `provisionSubStreamPath` (vlc-relay cameras
  // never get a sub-stream path registered).
  return camera.subStreamWidth && camera.rtspCompatMode !== "vlc-relay" ? subStreamPathName(camera.id) : camera.id;
}

function sourceUrlFor(camera: Camera): string {
  return `${env.mediamtxRtspUrl}/${sourcePathFor(camera)}`;
}

export function gridBroadcastPathName(gridId: string): string {
  return `grid_${gridId}`;
}

function outputArgs(gridId: string): string[] {
  return ["-f", "rtsp", "-rtsp_transport", "tcp", `${env.mediamtxRtspUrl}/${gridBroadcastPathName(gridId)}`];
}

function sameUrls(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i]);
}

interface RotationHandle {
  kind: "rotation";
  process: ChildProcess | null;
  cameraUrls: string[];
  intervalSeconds: number;
  index: number;
  timer: NodeJS.Timeout;
  stopping: boolean;
  /** Bumped on every intentional (re)spawn - lets a superseded process's exit handler tell "I was deliberately swapped out" apart from "I crashed unexpectedly", so it doesn't also schedule a redundant respawn. */
  generation: number;
}

interface MosaicHandle {
  kind: "mosaic";
  process: ChildProcess | null;
  cameraUrls: string[];
  columns: number;
  stopping: boolean;
}

type BridgeHandle = RotationHandle | MosaicHandle;

const activeBridges = new Map<string, BridgeHandle>();

function killProcess(child: ChildProcess | null): void {
  if (child && child.exitCode === null && !child.killed) {
    child.kill("SIGTERM");
  }
}

// ---- rotation mode: one input at a time, swapped by a timer -----------

function spawnRotationSegment(gridId: string, handle: RotationHandle): void {
  const url = handle.cameraUrls[handle.index];
  const generation = ++handle.generation;
  logger.info(
    { gridId, camera: handle.index + 1, of: handle.cameraUrls.length },
    "Grid broadcast (rotation): starting/switching camera"
  );

  const child = spawn(
    env.ffmpegPath,
    [
      "-rtsp_transport",
      "tcp",
      "-timeout",
      READ_TIMEOUT_US,
      "-i",
      url,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      ...outputArgs(gridId),
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  handle.process = child;

  child.stderr?.on("data", (chunk: Buffer) => logger.debug({ gridId }, chunk.toString("utf8").trim()));
  child.on("error", (err) => logger.error({ err, gridId }, "Failed to start grid broadcast (rotation) ffmpeg process"));
  child.on("exit", (code, signal) => {
    // Stale generation means this process was deliberately superseded by a
    // rotation switch or a full reconfigure (ensureRotationBroadcast) - the
    // replacement is already running (or about to be), so do nothing here.
    if (handle.stopping || activeBridges.get(gridId) !== handle || handle.generation !== generation) return;
    logger.warn({ gridId, code, signal }, "Grid broadcast (rotation) ffmpeg process exited; retrying same camera shortly");
    setTimeout(() => {
      if (activeBridges.get(gridId) === handle && !handle.stopping && handle.generation === generation) {
        spawnRotationSegment(gridId, handle);
      }
    }, RESPAWN_DELAY_MS);
  });
}

/** Advances to the next camera on the rotation timer - starts the next segment right away and lets the previous one wind down in the background (its exit handler no-ops, guarded by the generation bump inside spawnRotationSegment). */
function advanceRotation(gridId: string, handle: RotationHandle): void {
  handle.index = (handle.index + 1) % handle.cameraUrls.length;
  const previous = handle.process;
  spawnRotationSegment(gridId, handle);
  killProcess(previous);
}

async function ensureRotationBroadcast(gridId: string, cameraUrls: string[], intervalSeconds: number): Promise<void> {
  const existing = activeBridges.get(gridId);
  if (
    existing?.kind === "rotation" &&
    !existing.stopping &&
    existing.process &&
    existing.process.exitCode === null &&
    !existing.process.killed &&
    sameUrls(existing.cameraUrls, cameraUrls) &&
    existing.intervalSeconds === intervalSeconds
  ) {
    return;
  }
  await stopGridBroadcast(gridId);

  const handle: RotationHandle = {
    kind: "rotation",
    process: null,
    cameraUrls,
    intervalSeconds,
    index: 0,
    stopping: false,
    timer: null as unknown as NodeJS.Timeout,
    generation: 0,
  };
  handle.timer = setInterval(() => advanceRotation(gridId, handle), intervalSeconds * 1000);
  activeBridges.set(gridId, handle);
  spawnRotationSegment(gridId, handle);
}

// ---- mosaic mode: every camera at once, combined via xstack -----------

function buildMosaicArgs(gridId: string, cameraUrls: string[], columns: number): string[] {
  const inputArgs = cameraUrls.flatMap((url) => ["-rtsp_transport", "tcp", "-timeout", READ_TIMEOUT_US, "-i", url]);

  if (cameraUrls.length < 2) {
    // xstack needs at least 2 inputs - a single-camera "mosaic" just scales
    // and re-encodes that one camera instead.
    return [
      ...inputArgs,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-an",
      ...outputArgs(gridId),
    ];
  }

  const scaleFilters = cameraUrls.map((_, i) => `[${i}:v]scale=${TILE_WIDTH}:${TILE_HEIGHT},setsar=1[v${i}]`).join(";");
  const layout = cameraUrls.map((_, i) => `${(i % columns) * TILE_WIDTH}_${Math.floor(i / columns) * TILE_HEIGHT}`).join("|");
  const stackInputs = cameraUrls.map((_, i) => `[v${i}]`).join("");
  const filterComplex = `${scaleFilters};${stackInputs}xstack=inputs=${cameraUrls.length}:layout=${layout}:fill=black[out]`;

  return [
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    ...outputArgs(gridId),
  ];
}

function spawnMosaic(gridId: string, handle: MosaicHandle): void {
  logger.info({ gridId, cameras: handle.cameraUrls.length, columns: handle.columns }, "Starting grid broadcast (mosaic)");

  const child = spawn(env.ffmpegPath, buildMosaicArgs(gridId, handle.cameraUrls, handle.columns), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  handle.process = child;

  child.stderr?.on("data", (chunk: Buffer) => logger.debug({ gridId }, chunk.toString("utf8").trim()));
  child.on("error", (err) => logger.error({ err, gridId }, "Failed to start grid broadcast (mosaic) ffmpeg process"));
  child.on("exit", (code, signal) => {
    if (handle.stopping || activeBridges.get(gridId) !== handle) return;
    // Any one camera dropping kills the whole composite (a single
    // filter_complex graph, all-or-nothing) - just keep retrying the same
    // full set until every camera is reachable again.
    logger.warn({ gridId, code, signal }, "Grid broadcast (mosaic) ffmpeg process exited; respawning");
    setTimeout(() => {
      if (activeBridges.get(gridId) === handle && !handle.stopping) spawnMosaic(gridId, handle);
    }, RESPAWN_DELAY_MS);
  });
}

async function ensureMosaicBroadcast(gridId: string, cameraUrls: string[], columns: number): Promise<void> {
  const existing = activeBridges.get(gridId);
  if (
    existing?.kind === "mosaic" &&
    !existing.stopping &&
    existing.process &&
    existing.process.exitCode === null &&
    !existing.process.killed &&
    sameUrls(existing.cameraUrls, cameraUrls) &&
    existing.columns === columns
  ) {
    return;
  }
  await stopGridBroadcast(gridId);

  const handle: MosaicHandle = { kind: "mosaic", process: null, cameraUrls, columns, stopping: false };
  activeBridges.set(gridId, handle);
  spawnMosaic(gridId, handle);
}

/** Stops a grid's broadcast process (either mode), waiting for it to fully exit before resolving. Safe to call when nothing is running. */
export function stopGridBroadcast(gridId: string): Promise<void> {
  const handle = activeBridges.get(gridId);
  if (!handle) return Promise.resolve();
  activeBridges.delete(gridId);
  handle.stopping = true;
  if (handle.kind === "rotation") clearInterval(handle.timer);

  const proc = handle.process;
  if (!proc || proc.exitCode !== null || proc.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

export function stopAllGridBroadcasts(): void {
  for (const gridId of [...activeBridges.keys()]) {
    void stopGridBroadcast(gridId);
  }
}

export interface GridBroadcastStatus {
  gridId: string;
  mode: "mosaic" | "rotation";
  running: boolean;
  pid: number | null;
  cameraCount: number;
  /** Only meaningful for "rotation" - which camera (0-based) is currently on air. */
  currentIndex: number | null;
}

/** Snapshot of every currently-tracked grid broadcast process, for the Dashboard's process-health view. */
export function listGridBroadcastStatuses(): GridBroadcastStatus[] {
  return [...activeBridges.entries()].map(([gridId, handle]) => ({
    gridId,
    mode: handle.kind,
    running: handle.process !== null && handle.process.exitCode === null && !handle.process.killed,
    pid: handle.process?.pid ?? null,
    cameraCount: handle.cameraUrls.length,
    currentIndex: handle.kind === "rotation" ? handle.index : null,
  }));
}

/**
 * (Re)configures the optional broadcast stream for a grid: registers/removes
 * the `grid_<id>` MediaMTX path and starts/stops/reconfigures the matching
 * ffmpeg pipeline. Called on grid create/update, at boot for every grid
 * with a broadcast mode set, and by the reconciliation loop in index.ts if
 * MediaMTX forgets the path (e.g. it restarted on its own). Best-effort:
 * never throws - a failure here just means the broadcast stream isn't
 * available, the grid's normal web view is unaffected.
 */
export async function syncGridBroadcast(grid: Grid): Promise<void> {
  const pathName = gridBroadcastPathName(grid.id);
  try {
    if (grid.broadcastMode === "off") {
      await stopGridBroadcast(grid.id);
      await deleteCameraPath(pathName);
      return;
    }

    const cameras = grid.cameraIds
      .map((id) => getCameraById(id))
      .filter((camera): camera is Camera => camera !== null && camera.enabled);
    if (cameras.length === 0) {
      await stopGridBroadcast(grid.id);
      await deleteCameraPath(pathName);
      return;
    }

    await upsertCameraPath(pathName, { source: "publisher", sourceOnDemand: false, record: false });
    const cameraUrls = cameras.map(sourceUrlFor);
    if (grid.broadcastMode === "rotation") {
      await ensureRotationBroadcast(grid.id, cameraUrls, grid.broadcastIntervalSeconds);
    } else {
      await ensureMosaicBroadcast(grid.id, cameraUrls, grid.columns);
    }
  } catch (err) {
    logger.warn({ err, gridId: grid.id }, "Failed to sync grid broadcast stream");
  }
}

/** Fully tears down a grid's broadcast (process + MediaMTX path) - used on grid deletion. */
export async function stopGridBroadcastCompletely(gridId: string): Promise<void> {
  await stopGridBroadcast(gridId);
  await deleteCameraPath(gridBroadcastPathName(gridId));
}
