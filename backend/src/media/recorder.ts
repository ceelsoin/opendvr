import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

interface ActiveRecording {
  process: ChildProcess;
  cameraId: string;
  outputDir: string;
}

const activeRecordings = new Map<string, ActiveRecording>();

/**
 * Starts a segmented recording for a camera by piping its RTSP stream
 * through ffmpeg. Segments are written as `<outputDir>/%Y-%m-%d/%H-%M-%S.mp4`
 * so the timeline/browsing feature can group files by day.
 *
 * This spawns ffmpeg directly (no fluent-ffmpeg) to keep the dependency
 * footprint small and behavior predictable.
 */
export function startRecording(cameraId: string, rtspUri: string, segmentSeconds = 300): void {
  if (activeRecordings.has(cameraId)) {
    logger.warn({ cameraId }, "Recording already in progress for this camera");
    return;
  }

  const outputDir = path.join(env.recordingsDir, cameraId);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPattern = path.join(outputDir, "%Y-%m-%d_%H-%M-%S.mp4");

  const args = [
    "-rtsp_transport", "tcp",
    "-i", rtspUri,
    "-c", "copy",
    "-f", "segment",
    "-strftime", "1",
    "-segment_time", String(segmentSeconds),
    "-reset_timestamps", "1",
    outputPattern,
  ];

  const proc = spawn(env.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });

  proc.stderr?.on("data", (chunk: Buffer) => {
    logger.debug({ cameraId, ffmpeg: chunk.toString() }, "ffmpeg stderr");
  });

  proc.on("exit", (code, signal) => {
    logger.info({ cameraId, code, signal }, "ffmpeg recording process exited");
    activeRecordings.delete(cameraId);
  });

  proc.on("error", (err) => {
    logger.error({ cameraId, err }, "Failed to start ffmpeg recording process");
    activeRecordings.delete(cameraId);
  });

  activeRecordings.set(cameraId, { process: proc, cameraId, outputDir });
  logger.info({ cameraId, outputDir }, "Started recording");
}

export function stopRecording(cameraId: string): boolean {
  const recording = activeRecordings.get(cameraId);
  if (!recording) {
    return false;
  }
  recording.process.kill("SIGTERM");
  activeRecordings.delete(cameraId);
  logger.info({ cameraId }, "Stopped recording");
  return true;
}

export function isRecording(cameraId: string): boolean {
  return activeRecordings.has(cameraId);
}

export function stopAllRecordings(): void {
  for (const cameraId of activeRecordings.keys()) {
    stopRecording(cameraId);
  }
}
