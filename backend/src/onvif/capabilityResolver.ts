import { connectToDevice } from "./device.js";
import { captureSnapshot } from "./snapshot.js";
import { createPullPointSubscription, unsubscribe, type OnvifEventsService } from "./pullPointEvents.js";
import type { Camera, CameraCapabilities } from "../types/camera.js";
import { logger } from "../lib/logger.js";

type CameraCreds = Pick<Camera, "host" | "port" | "username" | "password"> & {
  onvifPath?: string;
  onvifProfileToken?: string | null;
};

export type { CameraCapabilities };

/**
 * Tries CreatePullPointSubscription against both the advertised Events
 * XAddr and the device's base ONVIF endpoint (same two-candidate fallback
 * `onvif/events.ts`'s real listener uses - some cheap stacks misreport the
 * Events XAddr, or route every namespace through a single path), tearing
 * the subscription back down immediately either way - this is a one-shot
 * capability probe, not a real listener.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function testOnvifEvents(device: any, camera: CameraCreds): Promise<boolean> {
  const eventsService = device.services?.events as OnvifEventsService | undefined;
  if (!eventsService) return false;

  const deviceBaseXaddr = `http://${camera.host}:${camera.port}${camera.onvifPath || "/onvif/device_service"}`;
  const candidateXaddrs = [...new Set([eventsService.xaddr, deviceBaseXaddr])];

  for (const xaddr of candidateXaddrs) {
    const candidateService: OnvifEventsService = { ...eventsService, xaddr };
    try {
      const subscriptionUrl = await createPullPointSubscription(candidateService);
      await unsubscribe(subscriptionUrl, candidateService).catch(() => {
        // Teardown failing doesn't mean the capability itself doesn't work.
      });
      return true;
    } catch {
      // Try the next candidate xaddr before giving up.
    }
  }
  return false;
}

/**
 * Actively probes what a camera's ONVIF stack actually supports, instead of
 * trusting what GetCapabilities advertises - proven unreliable on several
 * cheap/OEM cameras (see onvif/ptz.ts's docstring and
 * /memories/repo/onvif-events-pullpoint.md). See plans/05-capability-resolver.md.
 *
 * Every test is best-effort and independent - one failing never stops the
 * others from running - and this function itself never throws, so it's
 * safe to call during camera probe/creation without risking that flow.
 */
export async function resolveCapabilities(camera: CameraCreds): Promise<CameraCapabilities> {
  let ptz = false;
  let onvifEventsWork = false;
  let hasSubstream = false;
  let videoCodec: string | null = null;

  try {
    const device = await connectToDevice(camera);
    ptz = Boolean(device.services?.ptz);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profiles = (device.getProfileList() as any[]) ?? [];
      hasSubstream = profiles.length > 1;
      videoCodec = profiles[0]?.video?.encoder?.encoding ?? null;
    } catch (err) {
      logger.debug({ err, host: camera.host }, "Failed to inspect media profiles while resolving capabilities");
    }

    onvifEventsWork = await testOnvifEvents(device, camera);
  } catch (err) {
    logger.debug({ err, host: camera.host }, "Failed to connect while resolving camera capabilities");
  }

  const snapshotWorks = Boolean(
    await captureSnapshot({ ...camera, id: "capability-probe", onvifProfileToken: camera.onvifProfileToken ?? null }).catch(() => null)
  );

  return { ptz, onvifEventsWork, snapshotWorks, hasSubstream, videoCodec, probedAt: Date.now() };
}
