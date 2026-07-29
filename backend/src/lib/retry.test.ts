import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("resolves immediately if the first attempt succeeds, with no delay", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after a transient failure and eventually resolves", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, 5, 1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error once all attempts are exhausted", async () => {
    const err1 = new Error("first");
    const err2 = new Error("second - the last one");
    const fn = vi.fn().mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);

    await expect(withRetry(fn, 2, 1)).rejects.toBe(err2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never calls fn more than the given number of attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, 4, 1)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("defaults to 3 attempts (waits the default 800ms between them)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(withRetry(fn)).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10_000);
});
