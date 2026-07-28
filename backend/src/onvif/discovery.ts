import onvif from "onvif/promises";
import { logger } from "../lib/logger.js";

const { Discovery } = onvif;

export interface DiscoveredCamera {
  hostname: string;
  port: number;
  urn: string | null;
  xaddrs: string[];
}

/**
 * Runs a WS-Discovery probe on the local network to find ONVIF (NVT) devices.
 * Discovered devices are not yet authenticated - the user must supply
 * credentials before we can call `connect()` / `getProfiles()` etc.
 */
export function discoverCameras(timeoutMs = 5000): Promise<DiscoveredCamera[]> {
  return new Promise((resolve, reject) => {
    const found: DiscoveredCamera[] = [];

    const onError = (err: unknown) => {
      logger.warn({ err }, "ONVIF discovery received an unparsable reply");
    };

    Discovery.on("error", onError);

    Discovery.probe({ timeout: timeoutMs })
      .then((cams: any[]) => {
        for (const cam of cams) {
          found.push({
            hostname: cam.hostname,
            port: cam.port,
            urn: cam.urn ?? null,
            xaddrs: cam.xaddrs ?? [],
          });
        }
        resolve(found);
      })
      .catch(reject)
      .finally(() => {
        Discovery.removeListener("error", onError);
      });
  });
}
