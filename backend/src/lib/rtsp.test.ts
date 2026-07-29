import { describe, it, expect } from "vitest";
import { withRtspCredentials } from "./rtsp.js";

describe("withRtspCredentials", () => {
  it("embeds username and password into the URL's userinfo component", () => {
    const result = withRtspCredentials("rtsp://192.168.1.10:554/onvif1", "admin", "s3cr3t");
    expect(result).toBe("rtsp://admin:s3cr3t@192.168.1.10:554/onvif1");
  });

  it("replaces any existing credentials already in the URL", () => {
    const result = withRtspCredentials("rtsp://olduser:oldpass@192.168.1.10:554/onvif1", "admin", "newpass");
    expect(result).toBe("rtsp://admin:newpass@192.168.1.10:554/onvif1");
  });

  it("URL-encodes special characters in the password", () => {
    const result = withRtspCredentials("rtsp://192.168.1.10:554/onvif1", "admin", "p@ss:w/rd");
    const url = new URL(result);
    expect(url.username).toBe("admin");
    expect(url.password).toBe("p%40ss%3Aw%2Frd");
  });

  it("preserves query strings and paths", () => {
    const result = withRtspCredentials("rtsp://192.168.1.10:554/cam/realmonitor?channel=1&subtype=0", "admin", "pw");
    expect(result).toBe("rtsp://admin:pw@192.168.1.10:554/cam/realmonitor?channel=1&subtype=0");
  });

  it("handles an empty password (no username:password separator collapses oddly)", () => {
    const result = withRtspCredentials("rtsp://192.168.1.10:554/onvif1", "admin", "");
    const url = new URL(result);
    expect(url.username).toBe("admin");
    expect(url.password).toBe("");
  });
});
