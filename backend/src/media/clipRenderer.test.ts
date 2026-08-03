import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../config/env.js";
import { drawDetectionsOnClip } from "./clipRenderer.js";
import type { DetectionWithTrack } from "./objectTracker.js";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

function detection(overrides: Partial<DetectionWithTrack> = {}): DetectionWithTrack {
  return {
    label: "person",
    category: "person",
    confidence: 0.9,
    box: [0.1, 0.1, 0.3, 0.3],
    trackId: 1,
    framesSeen: 1,
    firstSeenAt: Date.now(),
    ...overrides,
  };
}

describe("drawDetectionsOnClip", () => {
  let tmpDir: string;
  let sampleClip: Buffer;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opendvr-clip-test-"));
    const samplePath = path.join(tmpDir, "sample.mp4");
    // Tiny synthetic 1s clip generated locally with ffmpeg itself - no
    // fixture file needed, and exercises the real ffmpeg invocation instead
    // of mocking child_process.
    await run(env.ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=1:r=10",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      samplePath,
    ]);
    sampleClip = await fs.readFile(samplePath);
  }, 20_000);

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("returns the same buffer unchanged when there are no detections", async () => {
    const result = await drawDetectionsOnClip(sampleClip, []);
    expect(result).toBe(sampleClip);
  });

  it("produces a valid, differently-encoded mp4 when a detection is drawn", async () => {
    const result = await drawDetectionsOnClip(sampleClip, [detection()]);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    // A real mp4 container starts with an ftyp box a few bytes in.
    expect(result!.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 20_000);

  it("chains multiple drawbox filters without failing when there are several detections", async () => {
    const result = await drawDetectionsOnClip(sampleClip, [
      detection({ category: "person", trackId: 1 }),
      detection({ category: "vehicle", trackId: 2, box: [0.5, 0.5, 0.2, 0.2] }),
    ]);
    expect(result).not.toBeNull();
    expect(result!.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }, 20_000);

  it("returns null (never throws) when the input isn't a valid video", async () => {
    const result = await drawDetectionsOnClip(Buffer.from("not a real video"), [detection()]);
    expect(result).toBeNull();
  });
});
