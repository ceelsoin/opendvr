import { describe, it, expect } from "vitest";
import { errorMessage } from "./errors.js";

describe("errorMessage", () => {
  it("returns the message of a real Error instance", () => {
    expect(errorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("returns a plain string as-is", () => {
    expect(errorMessage("just a string error")).toBe("just a string error");
  });

  it("JSON-stringifies plain objects", () => {
    expect(errorMessage({ code: "ECONNRESET", detail: "socket hang up" })).toBe(
      JSON.stringify({ code: "ECONNRESET", detail: "socket hang up" })
    );
  });

  it("falls back to String() for values that can't be JSON-stringified (circular refs)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const circular: any = {};
    circular.self = circular;
    expect(errorMessage(circular)).toBe(String(circular));
  });

  it("handles null (JSON.stringify(null) is the string \"null\")", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("returns undefined for undefined (JSON.stringify(undefined) returns undefined, not a string - a pre-existing quirk of this function, not a throw)", () => {
    expect(errorMessage(undefined)).toBeUndefined();
  });

  it("preserves subclassed Error messages (e.g. custom domain errors)", () => {
    class CameraOfflineError extends Error {}
    expect(errorMessage(new CameraOfflineError("camera unreachable"))).toBe("camera unreachable");
  });
});
