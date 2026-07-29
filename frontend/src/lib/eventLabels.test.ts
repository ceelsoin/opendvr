import { describe, it, expect, vi } from "vitest";
import { friendlyEventType } from "./eventLabels";

describe("friendlyEventType", () => {
  const t = vi.fn((key: string) => `translated:${key}`);

  it("recognizes a tampering topic (case-insensitive)", () => {
    expect(friendlyEventType("tns1:VideoSource/Tamper", t)).toBe("translated:eventTypes.tamperDetected");
  });

  it("recognizes a motion topic", () => {
    expect(friendlyEventType("tns1:RuleEngine/CellMotionDetector/Motion", t)).toBe("translated:eventTypes.motionDetected");
  });

  it("recognizes a line-crossing topic", () => {
    expect(friendlyEventType("tns1:RuleEngine/LineDetector/Crossed", t)).toBe("translated:eventTypes.lineCrossingDetected");
  });

  it("recognizes a field/intrusion detector topic", () => {
    expect(friendlyEventType("tns1:RuleEngine/FieldDetector/ObjectsInside", t)).toBe("translated:eventTypes.intrusionDetected");
    expect(friendlyEventType("some/intrusion/topic", t)).toBe("translated:eventTypes.intrusionDetected");
  });

  it("recognizes an occupancy topic", () => {
    expect(friendlyEventType("tns1:RuleEngine/Occupancy/PeopleCount", t)).toBe("translated:eventTypes.occupancyDetected");
  });

  it("returns the raw topic unchanged when nothing matches", () => {
    expect(friendlyEventType("tns1:SomeUnknownEvent/Foo", t)).toBe("tns1:SomeUnknownEvent/Foo");
  });

  it("prioritizes tamper over motion when both substrings somehow appear", () => {
    expect(friendlyEventType("tampermotion", t)).toBe("translated:eventTypes.tamperDetected");
  });
});
