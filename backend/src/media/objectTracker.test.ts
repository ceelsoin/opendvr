import { describe, it, expect, vi, afterEach } from "vitest";
import { clearTracks, tryReuseTrack, updateTracks } from "./objectTracker.js";
import type { ObjectDetection } from "./visionWorker.js";

function person(box: [number, number, number, number], confidence = 0.9): ObjectDetection {
  return { label: "person", category: "person", confidence, box };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("objectTracker", () => {
  it("keeps the same trackId across calls when a detection barely moves", () => {
    const cameraId = "cam-barely-moves";
    const first = updateTracks(cameraId, [person([0.1, 0.1, 0.2, 0.3])]);
    const second = updateTracks(cameraId, [person([0.11, 0.1, 0.2, 0.3])]);
    expect(first[0].trackId).toBe(second[0].trackId);
    expect(second[0].framesSeen).toBe(2);
  });

  it("does not swap IDs between two objects detected in a stable arrangement", () => {
    const cameraId = "cam-two-objects";
    const first = updateTracks(cameraId, [person([0.0, 0.0, 0.1, 0.1]), person([0.8, 0.8, 0.1, 0.1])]);
    const second = updateTracks(cameraId, [person([0.01, 0.0, 0.1, 0.1]), person([0.79, 0.8, 0.1, 0.1])]);
    // first[0] (top-left) should still match second[0] (top-left), not the far one.
    expect(second[0].trackId).toBe(first[0].trackId);
    expect(second[1].trackId).toBe(first[1].trackId);
    expect(second[0].trackId).not.toBe(second[1].trackId);
  });

  it("creates a new track for a detection that doesn't match anything existing", () => {
    const cameraId = "cam-new-object";
    const first = updateTracks(cameraId, [person([0.0, 0.0, 0.1, 0.1])]);
    const second = updateTracks(cameraId, [person([0.0, 0.0, 0.1, 0.1]), person([0.9, 0.9, 0.1, 0.1])]);
    const matched = second.find((d) => d.trackId === first[0].trackId);
    const created = second.find((d) => d.trackId !== first[0].trackId);
    expect(matched).toBeDefined();
    expect(created).toBeDefined();
    expect(created?.framesSeen).toBe(1);
  });

  it("expires a track after it hasn't been seen for longer than the TTL", () => {
    const cameraId = "cam-expires";
    const first = updateTracks(cameraId, [person([0.1, 0.1, 0.2, 0.2])]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 30_000); // past TRACK_TTL_MS (20s)
    const second = updateTracks(cameraId, [person([0.1, 0.1, 0.2, 0.2])]);
    expect(second[0].trackId).not.toBe(first[0].trackId);
    expect(second[0].framesSeen).toBe(1);
  });

  it("tryReuseTrack reuses a fresh track that overlaps the motion box, without a new YOLO call", () => {
    const cameraId = "cam-reuse";
    const [tracked] = updateTracks(cameraId, [person([0.2, 0.2, 0.2, 0.2])]);
    const reused = tryReuseTrack(cameraId, [0.21, 0.2, 0.2, 0.2]);
    expect(reused).not.toBeNull();
    expect(reused?.trackId).toBe(tracked.trackId);
    expect(reused?.framesSeen).toBe(2);
    expect(reused?.category).toBe("person");
  });

  it("tryReuseTrack returns null when nothing matches the motion box", () => {
    const cameraId = "cam-reuse-miss";
    updateTracks(cameraId, [person([0.0, 0.0, 0.1, 0.1])]);
    const reused = tryReuseTrack(cameraId, [0.9, 0.9, 0.05, 0.05]);
    expect(reused).toBeNull();
  });

  it("tryReuseTrack stops reusing after MAX_SKIPS_BEFORE_RECHECK, forcing a real re-detection", () => {
    const cameraId = "cam-force-recheck";
    updateTracks(cameraId, [person([0.3, 0.3, 0.2, 0.2])]);
    const box: [number, number, number, number] = [0.3, 0.3, 0.2, 0.2];
    let reuseCount = 0;
    let lastResult = tryReuseTrack(cameraId, box);
    while (lastResult) {
      reuseCount += 1;
      lastResult = tryReuseTrack(cameraId, box);
    }
    // Bounded: the tracker must eventually force a real re-check rather than
    // reusing forever.
    expect(reuseCount).toBeGreaterThan(0);
    expect(reuseCount).toBeLessThan(10);
  });

  it("tryReuseTrack does not reuse a track older than its own reuse-freshness window", () => {
    const cameraId = "cam-reuse-stale";
    updateTracks(cameraId, [person([0.4, 0.4, 0.2, 0.2])]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 9_000); // past REUSE_MAX_AGE_MS (8s) but under TRACK_TTL_MS (20s)
    const reused = tryReuseTrack(cameraId, [0.4, 0.4, 0.2, 0.2]);
    expect(reused).toBeNull();
  });

  it("clearTracks drops all state for a camera", () => {
    const cameraId = "cam-clear";
    const [tracked] = updateTracks(cameraId, [person([0.5, 0.5, 0.1, 0.1])]);
    clearTracks(cameraId);
    const after = updateTracks(cameraId, [person([0.5, 0.5, 0.1, 0.1])]);
    expect(after[0].trackId).not.toBe(tracked.trackId);
    expect(after[0].framesSeen).toBe(1);
  });
});
