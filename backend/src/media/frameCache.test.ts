import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./frameSnapshot.js", () => ({
  captureFrameSnapshot: vi.fn(),
}));

import { captureFrameSnapshot } from "./frameSnapshot.js";
import { getFrame, getRecentFrame, removeFrame, setFrame } from "./frameCache.js";

const mockedCapture = vi.mocked(captureFrameSnapshot);

describe("frameCache", () => {
  beforeEach(() => {
    removeFrame("cam-1");
    mockedCapture.mockReset();
  });

  it("returns null when nothing has been cached yet", () => {
    expect(getFrame("cam-1")).toBeNull();
  });

  it("setFrame stores a frame without touching ffmpeg", () => {
    const buffer = Buffer.from("jpeg-bytes");
    setFrame("cam-1", buffer, "motion");
    expect(getFrame("cam-1")?.buffer).toBe(buffer);
    expect(getFrame("cam-1")?.source).toBe("motion");
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("getRecentFrame returns the cached frame when it's fresh enough", async () => {
    const buffer = Buffer.from("fresh");
    setFrame("cam-1", buffer, "poll");
    const result = await getRecentFrame("cam-1", 60_000);
    expect(result).toBe(buffer);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("getRecentFrame falls back to a fresh capture when the cache is empty", async () => {
    const fresh = Buffer.from("freshly-captured");
    mockedCapture.mockResolvedValue(fresh);
    const result = await getRecentFrame("cam-1", 60_000);
    expect(result).toBe(fresh);
    expect(mockedCapture).toHaveBeenCalledWith("cam-1");
    // the fallback capture is cached too, for subsequent callers
    expect(getFrame("cam-1")?.buffer).toBe(fresh);
  });

  it("getRecentFrame falls back when the cached frame is older than maxAgeMs", async () => {
    const stale = Buffer.from("stale");
    setFrame("cam-1", stale, "poll");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    const fresh = Buffer.from("fresh-after-expiry");
    mockedCapture.mockResolvedValue(fresh);
    const result = await getRecentFrame("cam-1", 60_000);
    expect(result).toBe(fresh);
    vi.useRealTimers();
  });

  it("getRecentFrame returns null when there's no cache and the fallback capture fails", async () => {
    mockedCapture.mockResolvedValue(null);
    const result = await getRecentFrame("cam-1", 60_000);
    expect(result).toBeNull();
    expect(getFrame("cam-1")).toBeNull();
  });

  it("removeFrame clears the cached entry", () => {
    setFrame("cam-1", Buffer.from("x"), "motion");
    removeFrame("cam-1");
    expect(getFrame("cam-1")).toBeNull();
  });
});
