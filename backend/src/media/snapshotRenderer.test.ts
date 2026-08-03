import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { drawDetections } from "./snapshotRenderer.js";
import type { DetectionWithTrack } from "./objectTracker.js";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();
}

function detection(overrides: Partial<DetectionWithTrack> = {}): DetectionWithTrack {
  return {
    label: "person",
    category: "person",
    confidence: 0.87,
    box: [0.1, 0.2, 0.3, 0.4],
    trackId: 1,
    framesSeen: 2,
    firstSeenAt: Date.now(),
    ...overrides,
  };
}

describe("drawDetections", () => {
  it("returns the same buffer unchanged when there are no detections", async () => {
    const jpeg = await makeJpeg(100, 100);
    const result = await drawDetections(jpeg, []);
    expect(result).toBe(jpeg);
  });

  it("returns a valid JPEG with the same dimensions when detections are drawn", async () => {
    const jpeg = await makeJpeg(200, 150);
    const result = await drawDetections(jpeg, [detection()]);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(150);
  });

  it("produces a different buffer than the original once something is drawn", async () => {
    const jpeg = await makeJpeg(200, 150);
    const result = await drawDetections(jpeg, [detection()]);
    expect(Buffer.compare(result, jpeg)).not.toBe(0);
  });

  it("handles multiple detections across categories without throwing", async () => {
    const jpeg = await makeJpeg(320, 240);
    const result = await drawDetections(jpeg, [
      detection({ category: "person", trackId: 1 }),
      detection({ category: "vehicle", trackId: 2, box: [0.5, 0.5, 0.2, 0.2] }),
      detection({ category: "animal", trackId: 3, box: [0.0, 0.0, 0.1, 0.1] }),
    ]);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe("jpeg");
  });
});
