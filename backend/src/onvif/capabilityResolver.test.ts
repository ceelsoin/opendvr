import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./device.js", () => ({
  connectToDevice: vi.fn(),
}));
vi.mock("./snapshot.js", () => ({
  captureSnapshot: vi.fn(),
}));
vi.mock("./pullPointEvents.js", () => ({
  createPullPointSubscription: vi.fn(),
  unsubscribe: vi.fn(),
}));

import { connectToDevice } from "./device.js";
import { captureSnapshot } from "./snapshot.js";
import { createPullPointSubscription, unsubscribe } from "./pullPointEvents.js";
import { resolveCapabilities } from "./capabilityResolver.js";

const mockedConnect = vi.mocked(connectToDevice);
const mockedSnapshot = vi.mocked(captureSnapshot);
const mockedSubscribe = vi.mocked(createPullPointSubscription);
const mockedUnsubscribe = vi.mocked(unsubscribe);

const camera = { host: "192.168.1.10", port: 80, username: "admin", password: "pass", onvifPath: "/onvif/device_service" };

function fakeDevice(overrides: Record<string, unknown> = {}) {
  return {
    services: { ptz: { xaddr: "http://cam/ptz" }, events: { xaddr: "http://cam/events", user: "admin", pass: "pass" } },
    getProfileList: () => [
      { token: "main", video: { encoder: { encoding: "H264" } } },
      { token: "sub", video: { encoder: { encoding: "H264" } } },
    ],
    ...overrides,
  };
}

describe("resolveCapabilities", () => {
  beforeEach(() => {
    mockedConnect.mockReset();
    mockedSnapshot.mockReset();
    mockedSubscribe.mockReset();
    mockedUnsubscribe.mockReset();
  });

  it("reports every capability as working when everything succeeds", async () => {
    mockedConnect.mockResolvedValue(fakeDevice());
    mockedSubscribe.mockResolvedValue("http://cam/subscription/1");
    mockedUnsubscribe.mockResolvedValue(undefined);
    mockedSnapshot.mockResolvedValue(Buffer.from("jpeg"));

    const caps = await resolveCapabilities(camera);

    expect(caps.ptz).toBe(true);
    expect(caps.onvifEventsWork).toBe(true);
    expect(caps.hasSubstream).toBe(true);
    expect(caps.videoCodec).toBe("H264");
    expect(caps.snapshotWorks).toBe(true);
    expect(typeof caps.probedAt).toBe("number");
    expect(mockedUnsubscribe).toHaveBeenCalledWith("http://cam/subscription/1", expect.anything());
  });

  it("reports ptz false when the device doesn't advertise a PTZ service", async () => {
    mockedConnect.mockResolvedValue(fakeDevice({ services: { events: undefined, ptz: undefined } }));
    mockedSnapshot.mockResolvedValue(null);

    const caps = await resolveCapabilities(camera);

    expect(caps.ptz).toBe(false);
    expect(caps.onvifEventsWork).toBe(false);
  });

  it("reports onvifEventsWork false when subscribing fails on every candidate xaddr", async () => {
    mockedConnect.mockResolvedValue(fakeDevice());
    mockedSubscribe.mockRejectedValue(new Error("socket hang up"));
    mockedSnapshot.mockResolvedValue(null);

    const caps = await resolveCapabilities(camera);

    expect(caps.onvifEventsWork).toBe(false);
    // advertised events xaddr + device base xaddr = 2 candidates
    expect(mockedSubscribe).toHaveBeenCalledTimes(2);
  });

  it("falls back to the device's base xaddr when the advertised Events xaddr fails", async () => {
    mockedConnect.mockResolvedValue(fakeDevice());
    mockedSubscribe
      .mockRejectedValueOnce(new Error("socket hang up on advertised xaddr"))
      .mockResolvedValueOnce("http://cam/subscription/2");
    mockedUnsubscribe.mockResolvedValue(undefined);
    mockedSnapshot.mockResolvedValue(null);

    const caps = await resolveCapabilities(camera);

    expect(caps.onvifEventsWork).toBe(true);
    expect(mockedSubscribe).toHaveBeenCalledTimes(2);
  });

  it("never throws, even when connecting to the device fails entirely", async () => {
    mockedConnect.mockRejectedValue(new Error("ECONNRESET"));
    mockedSnapshot.mockResolvedValue(null);

    const caps = await resolveCapabilities(camera);

    expect(caps).toEqual({
      ptz: false,
      onvifEventsWork: false,
      hasSubstream: false,
      videoCodec: null,
      snapshotWorks: false,
      probedAt: expect.any(Number),
    });
  });

  it("reports snapshotWorks false when captureSnapshot resolves null", async () => {
    mockedConnect.mockResolvedValue(fakeDevice());
    mockedSubscribe.mockResolvedValue("http://cam/subscription/3");
    mockedUnsubscribe.mockResolvedValue(undefined);
    mockedSnapshot.mockResolvedValue(null);

    const caps = await resolveCapabilities(camera);

    expect(caps.snapshotWorks).toBe(false);
  });
});
