import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { env } from "../config/env.js";
import { getCaptionSettings, type CaptionSettings } from "../notifications/captionSettings.js";
import { logger } from "../lib/logger.js";

/**
 * Manages the local llama.cpp `llama-server` process for item 4's "local"
 * captioning provider (see notifications/captionSettings.ts) - a SINGLE
 * shared process for the whole app, same idea as media/visionWorker.ts.
 * llama-server already speaks the OpenAI-compatible `/v1/chat/completions`
 * protocol natively, so notifications/captioning.ts needs no special-casing
 * beyond picking which base URL to call (see getLocalEndpoint()).
 *
 * Fully driven by Settings-page config (model/mmproj paths, CPU threads or
 * GPU layers, context size, port) - `syncLlamaCppBridge()` is called both on
 * boot and after every Settings save, and (re)starts/stops the process as
 * needed to always match the current configuration. GPU acceleration is
 * passed through faithfully (`--n-gpu-layers`), but the binary built into
 * this image (see Dockerfile) is CPU-only (CUDA doesn't support musl/Alpine)
 * - it only has any effect if `LLAMACPP_SERVER_PATH` points at a different,
 * GPU-capable binary (see docs/configuration.md).
 */

interface BridgeHandle {
  process: ChildProcess;
  /** Set before an intentional stop/restart, so the exit handler knows not to auto-respawn. */
  stopping: boolean;
  /** Serialized config this process was started with - used to detect "settings changed, needs restart". */
  configKey: string;
  /** Port this specific process instance is actually listening on. */
  port: number;
}

const RESPAWN_DELAY_MS = 3000;

let handle: BridgeHandle | null = null;

function configKeyFor(settings: CaptionSettings): string {
  return JSON.stringify({
    modelPath: settings.localModelPath,
    mmprojPath: settings.localMmprojPath,
    acceleration: settings.localAcceleration,
    threads: settings.localThreads,
    gpuLayers: settings.localGpuLayers,
    contextSize: settings.localContextSize,
    port: settings.localPort,
  });
}

function shouldRun(settings: CaptionSettings): boolean {
  if (!settings.enabled || settings.provider !== "local") {
    return false;
  }
  if (!settings.localModelPath || !settings.localMmprojPath) {
    return false;
  }
  if (!fs.existsSync(settings.localModelPath) || !fs.existsSync(settings.localMmprojPath)) {
    // Missing files (e.g. an older image built before the model was
    // bundled, or a volume that lost its seeded files) - warn instead of
    // spawning a process that would just crash-loop.
    logger.warn(
      { modelPath: settings.localModelPath, mmprojPath: settings.localMmprojPath },
      "Local captioning is enabled but the model/mmproj file(s) don't exist - skipping"
    );
    return false;
  }
  return true;
}

function buildArgs(settings: CaptionSettings): string[] {
  const args = [
    "-m",
    settings.localModelPath!,
    "--mmproj",
    settings.localMmprojPath!,
    "--host",
    "127.0.0.1",
    "--port",
    String(settings.localPort),
    "-c",
    String(settings.localContextSize),
    "--threads",
    String(settings.localThreads),
  ];
  if (settings.localAcceleration === "gpu" && settings.localGpuLayers > 0) {
    args.push("--n-gpu-layers", String(settings.localGpuLayers));
  }
  return args;
}

function spawnBridge(settings: CaptionSettings): void {
  const configKey = configKeyFor(settings);
  logger.info({ port: settings.localPort, acceleration: settings.localAcceleration }, "Starting local llama.cpp captioning server");

  const child = spawn(env.llamaCppServerPath, buildArgs(settings), { stdio: ["ignore", "pipe", "pipe"] });
  const current: BridgeHandle = { process: child, stopping: false, configKey, port: settings.localPort };
  handle = current;

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    logger.debug({ line }, "llama-server stdout");
  });
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    logger.debug({ line }, "llama-server stderr");
  });

  child.on("error", (err) => {
    logger.warn({ err }, "Failed to start local llama.cpp captioning server - check LLAMACPP_SERVER_PATH and model paths");
  });

  child.on("exit", (code, signal) => {
    if (handle === current) {
      handle = null;
    }
    if (current.stopping) {
      return;
    }
    logger.warn({ code, signal }, "Local llama.cpp captioning server exited unexpectedly; re-evaluating in a moment");
    setTimeout(syncLlamaCppBridge, RESPAWN_DELAY_MS).unref();
  });
}

function stopBridge(): void {
  if (!handle) return;
  handle.stopping = true;
  handle.process.kill();
  handle = null;
}

/**
 * Reconciles the running process (if any) against the current Settings:
 * starts it if the local provider is now configured and enabled, stops it
 * if it was disabled/switched away from "local", and restarts it if the
 * configuration (model paths, acceleration, port, etc) changed. Safe to
 * call repeatedly/redundantly - a no-op when already in the right state.
 */
export function syncLlamaCppBridge(): void {
  const settings = getCaptionSettings();

  if (!shouldRun(settings)) {
    stopBridge();
    return;
  }

  const desiredKey = configKeyFor(settings);
  if (handle && handle.configKey === desiredKey && handle.process.exitCode === null && !handle.process.killed) {
    return;
  }

  stopBridge();
  spawnBridge(settings);
}

/** Base URL for the local llama-server's OpenAI-compatible API, or `null` if it isn't currently running. */
export function getLocalEndpoint(): string | null {
  if (!handle || handle.process.exitCode !== null || handle.process.killed) {
    return null;
  }
  return `http://127.0.0.1:${handle.port}/v1`;
}

export function isLlamaCppBridgeRunning(): boolean {
  return handle !== null;
}
