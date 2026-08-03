import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../config/env.js";
import type { DetectionWithTrack } from "./objectTracker.js";

const CATEGORY_COLORS: Record<string, string> = {
  person: "red",
  vehicle: "blue",
  animal: "green",
  other: "yellow",
};

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(env.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
  });
}

/**
 * Burns static bounding boxes (from the event's trigger detections) onto an
 * already-fetched event clip, via ffmpeg's `drawbox` filter - a one-shot,
 * short (event-clip-length, see media/eventClip.ts) job, NOT a continuous/
 * live process - see plans/03-stream-anotada-renderer.md and
 * media/snapshotRenderer.ts (the same idea, for the JPEG snapshot case).
 * The box stays static for the whole clip (we only have the trigger's
 * detections, not per-frame tracking within the clip itself) - same
 * simplification already accepted for the snapshot case.
 *
 * Uses temp files rather than stdin/stdout pipes: fMP4 output needs a
 * seekable file to place its `moov` atom correctly (`+faststart`), which a
 * non-seekable pipe can't provide. Best-effort - returns null on any
 * failure so the caller can fall back to the original clip.
 */
export async function drawDetectionsOnClip(mp4: Buffer, detections: DetectionWithTrack[]): Promise<Buffer | null> {
  if (detections.length === 0) {
    return mp4;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opendvr-clip-"));
  const inputPath = path.join(tmpDir, "input.mp4");
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    await fs.writeFile(inputPath, mp4);

    const drawboxFilters = detections
      .map((detection) => {
        const [x, y, w, h] = detection.box;
        const color = CATEGORY_COLORS[detection.category] ?? CATEGORY_COLORS.other;
        return `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=${color}:thickness=4`;
      })
      .join(",");

    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-vf",
      drawboxFilters,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    return await fs.readFile(outputPath);
  } catch {
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
