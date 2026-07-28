import { spawn } from "node:child_process";
import { env } from "../config/env.js";

/**
 * Grabs a single JPEG frame directly from MediaMTX's already-connected RTSP
 * feed via ffmpeg, as a fallback when the camera's own ONVIF snapshot
 * (onvif/snapshot.ts) fails or isn't supported. Used to make "always have a
 * snapshot for an event" actually reliable regardless of how broken a given
 * camera's ONVIF stack is - MediaMTX/ffmpeg only need the RTSP stream that's
 * already flowing, not any camera-side snapshot feature.
 */
export function captureFrameSnapshot(cameraId: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Buffer | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const args = [
      "-rtsp_transport",
      "tcp",
      "-i",
      `${env.mediamtxRtspUrl}/${cameraId}`,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-f",
      "image2",
      "-",
    ];
    const proc = spawn(env.ffmpegPath, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("error", () => finish(null));
    proc.on("close", (code) => {
      finish(code === 0 && chunks.length > 0 ? Buffer.concat(chunks) : null);
    });

    const timeout = setTimeout(() => {
      proc.kill();
      finish(null);
    }, 10_000);
    timeout.unref();
  });
}
