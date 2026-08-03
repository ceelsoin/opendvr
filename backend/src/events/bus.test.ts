import { describe, it, expect, vi } from "vitest";
import { eventBus } from "./bus.js";
import type { NotificationEvent } from "../notifications/channel.js";

function makeEvent(): NotificationEvent {
  return {
    kind: "camera_event",
    camera: { id: "cam-1", name: "Front door" },
    topic: "object:person",
    message: "Person detected",
    subject: "OpenDVR: Person detected (Front door)",
    occurredAt: new Date().toISOString(),
  };
}

describe("eventBus", () => {
  it("delivers an emitted camera:event to a subscribed listener", () => {
    const listener = vi.fn();
    eventBus.onTyped("camera:event", listener);
    const event = makeEvent();
    eventBus.emitTyped("camera:event", event);
    expect(listener).toHaveBeenCalledWith(event);
    eventBus.off("camera:event", listener);
  });

  it("does not deliver camera:event to a listener subscribed to a different event name", () => {
    const listener = vi.fn();
    eventBus.onTyped("camera:unavailable", listener);
    eventBus.emitTyped("camera:event", makeEvent());
    expect(listener).not.toHaveBeenCalled();
    eventBus.off("camera:unavailable", listener);
  });
});
