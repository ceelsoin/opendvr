import { describe, it, expect, beforeEach } from "vitest";
import { usePtzTargetStore } from "./ptzTargetStore";

describe("usePtzTargetStore", () => {
  beforeEach(() => {
    usePtzTargetStore.setState({ target: null });
  });

  it("starts with no target selected", () => {
    expect(usePtzTargetStore.getState().target).toBeNull();
  });

  it("setTarget selects a camera", () => {
    usePtzTargetStore.getState().setTarget({ id: "cam-1", name: "Quintal" });
    expect(usePtzTargetStore.getState().target).toEqual({ id: "cam-1", name: "Quintal" });
  });

  it("toggleTarget selects a camera when none is active", () => {
    usePtzTargetStore.getState().toggleTarget({ id: "cam-1", name: "Quintal" });
    expect(usePtzTargetStore.getState().target?.id).toBe("cam-1");
  });

  it("toggleTarget deselects when toggling the already-active camera", () => {
    usePtzTargetStore.getState().toggleTarget({ id: "cam-1", name: "Quintal" });
    usePtzTargetStore.getState().toggleTarget({ id: "cam-1", name: "Quintal" });
    expect(usePtzTargetStore.getState().target).toBeNull();
  });

  it("toggleTarget switches to a different camera without needing to deselect first", () => {
    usePtzTargetStore.getState().toggleTarget({ id: "cam-1", name: "Quintal" });
    usePtzTargetStore.getState().toggleTarget({ id: "cam-2", name: "Garagem" });
    expect(usePtzTargetStore.getState().target?.id).toBe("cam-2");
  });

  it("clearTarget always deselects, regardless of current state", () => {
    usePtzTargetStore.getState().setTarget({ id: "cam-1", name: "Quintal" });
    usePtzTargetStore.getState().clearTarget();
    expect(usePtzTargetStore.getState().target).toBeNull();
  });
});
