import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Manages the SINGLE shared `vision_worker.py` process (unlike
 * motionDetector.ts, which spawns one motion_worker.py per camera) - see
 * that script's own docstring for why a shared process matters on weak
 * hardware. Talks to it via newline-delimited JSON request/response over
 * stdin/stdout, correlated by an incrementing request id (a minimal
 * RPC-over-stdio client, same idea as a JSON-RPC transport).
 */

const WORKER_SCRIPT_PATH = path.join(process.cwd(), "vision_worker.py");
const RESPAWN_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;

export interface ObjectDetection {
  label: string;
  category: "person" | "vehicle" | "animal" | "other";
  confidence: number;
  /** Normalized [x, y, w, h], 0..1. */
  box: [number, number, number, number];
}

export interface FaceDetection {
  box: [number, number, number, number];
  embedding: number[];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

let child: ChildProcess | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function handleLine(line: string): void {
  let parsed: { id?: number; result?: unknown; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof parsed.id !== "number") return;
  const request = pending.get(parsed.id);
  if (!request) return;
  pending.delete(parsed.id);
  clearTimeout(request.timeout);
  if (parsed.error) {
    request.reject(new Error(parsed.error));
  } else {
    request.resolve(parsed.result);
  }
}

export function startVisionWorker(): void {
  if (child) return;

  fs.mkdirSync(path.dirname(env.visionYoloModelPath), { recursive: true });

  child = spawn(
    "python3",
    [
      WORKER_SCRIPT_PATH,
      env.visionYoloModelPath,
      String(env.visionYoloInputSize),
      env.visionFaceDetectModelPath,
      env.visionFaceRecognizeModelPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  const currentChild = child;

  readline.createInterface({ input: currentChild.stdout! }).on("line", handleLine);
  readline.createInterface({ input: currentChild.stderr! }).on("line", (line) => {
    logger.debug({ line }, "vision_worker.py");
  });

  currentChild.on("error", (err) => {
    logger.warn({ err }, "Failed to start shared vision worker process");
  });

  currentChild.on("exit", (code, signal) => {
    if (child === currentChild) {
      child = null;
    }
    // Any in-flight requests against the now-dead process will never get a
    // reply - reject them immediately instead of waiting for their timeout.
    for (const [id, request] of pending) {
      clearTimeout(request.timeout);
      request.reject(new Error("vision worker process exited"));
      pending.delete(id);
    }
    logger.warn({ code, signal }, "Vision worker process exited unexpectedly; respawning");
    setTimeout(startVisionWorker, RESPAWN_DELAY_MS).unref();
  });

  logger.info("Started shared vision worker (object detection / face recognition)");
}

function request<T>(task: string, image: Buffer): Promise<T> {
  if (!child || !child.stdin?.writable) {
    return Promise.reject(new Error("vision worker not running"));
  }
  const id = nextRequestId++;
  const payload = JSON.stringify({ id, task, image: image.toString("base64") }) + "\n";

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("vision worker request timed out"));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
    child!.stdin!.write(payload, (err) => {
      if (err) {
        pending.delete(id);
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

/** Runs YOLO object detection on a JPEG frame. Rejects if the model file isn't available/configured - callers should treat that as "feature unavailable", not a hard error. */
export function detectObjects(image: Buffer): Promise<{ objects: ObjectDetection[] }> {
  return request("detect", image);
}

/** Runs face detection + embedding extraction on a JPEG frame (used both for live matching and for enrollment via POST /api/faces). */
export function detectFaces(image: Buffer): Promise<{ faces: FaceDetection[] }> {
  return request("face", image);
}

/** Returns the embedding of the single largest face in a photo, or rejects with "no_face_detected" - used only for face enrollment. */
export function embedSingleFace(image: Buffer): Promise<{ embedding: number[] }> {
  return request("embed_face", image);
}

export function isVisionWorkerRunning(): boolean {
  return child !== null;
}

export interface VisionWorkerStatus {
  running: boolean;
  pid: number | null;
  /** Requests waiting on a reply - a persistently non-zero value suggests the worker is stuck/overloaded, not just momentarily busy. */
  pendingRequests: number;
}

/** Snapshot of the single shared vision_worker.py process, for the Dashboard's process-health view. */
export function getVisionWorkerStatus(): VisionWorkerStatus {
  return {
    running: child !== null,
    pid: child?.pid ?? null,
    pendingRequests: pending.size,
  };
}
