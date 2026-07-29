import { describe, it, expect } from "vitest";
import { rotationFilter } from "./rotationBridge.js";

describe("rotationFilter", () => {
  it("maps 90 degrees to a single clockwise transpose", () => {
    expect(rotationFilter(90)).toBe("transpose=1");
  });

  it("maps 270 degrees to a single counter-clockwise transpose", () => {
    expect(rotationFilter(270)).toBe("transpose=2");
  });

  it("maps 180 degrees to a double transpose (equivalent to hflip+vflip)", () => {
    expect(rotationFilter(180)).toBe("transpose=2,transpose=2");
  });
});
