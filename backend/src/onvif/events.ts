import type { Camera } from "../types/camera.js";
import { connectToDevice } from "./device.js";
import { createPullPointSubscription, pullMessages, unsubscribe, type OnvifEventsService } from "./pullPointEvents.js";
import { recordCameraEvent } from "../events/cameraEvents.js";
import { logger } from "../lib/logger.js";

interface ActiveListener {
  stopped: boolean;
  subscriptionUrl: string;
  eventsService: OnvifEventsService;
}

const activeListeners = new Map<string, ActiveListener>();

/** Whether the ONVIF PullPoint listener should run for this camera at all: needed both for
 * plain motion alerts (toast/green flash) and, additionally, to drive motion-triggered recording. */
export function shouldListenForEvents(camera: Pick<Camera, "motionRecording" | "recordingMode">): boolean {
  return camera.motionRecording || camera.recordingMode === "motion";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Long-running pull loop for a single camera; exits once `listener.stopped` is set. */
async function pullLoop(camera: Camera, listener: ActiveListener): Promise<void> {
  while (!listener.stopped) {
    try {
      const notifications = await pullMessages(listener.subscriptionUrl, listener.eventsService, 30, 50);
      for (const notification of notifications) {
        recordCameraEvent(camera, notification.topic, notification.message);
      }
    } catch (err) {
      if (listener.stopped) {
        break;
      }
      logger.warn({ err, cameraId: camera.id }, "ONVIF PullMessages failed; re-subscribing");
      await sleep(5000);
      if (listener.stopped) {
        break;
      }
      try {
        listener.subscriptionUrl = await createPullPointSubscription(listener.eventsService);
      } catch (resubscribeErr) {
        logger.warn({ err: resubscribeErr, cameraId: camera.id }, "Failed to re-create ONVIF PullPoint subscription");
        await sleep(15000);
      }
    }
  }
}

/**
 * Subscribes to a camera's ONVIF PullPoint events (motion, tamper, etc.) via
 * a manual WS-BaseNotification client (see onvif/pullPointEvents.ts) built
 * on top of `node-onvif`'s already-working connection, instead of the
 * legacy `onvif` package.
 *
 * Why not the `onvif` package: its `Cam.connect()` always starts with an
 * *unauthenticated* GetSystemDateAndTime call, which resets the TCP
 * connection on several cheap/OEM cameras (the same incompatibility
 * documented in device.ts that motivated using `node-onvif` for
 * connect/media/PTZ). `node-onvif` doesn't make that call and connects to
 * these cameras fine, but only implements a bare `getEventProperties` for
 * events - pullPointEvents.ts fills in CreatePullPointSubscription/
 * PullMessages/Unsubscribe with raw SOAP requests reusing node-onvif's
 * already-resolved xaddr/credentials/clock offset.
 */
export async function startEventListener(camera: Camera): Promise<void> {
  if (activeListeners.has(camera.id)) {
    return;
  }

  try {
    const device = await connectToDevice(camera);
    const eventsService = device.services?.events as OnvifEventsService | undefined;
    if (!eventsService) {
      logger.warn({ cameraId: camera.id }, "Camera does not advertise an ONVIF Events service; motion alerts unavailable");
      return;
    }

    // Some cheap/OEM camera firmwares misreport the Events XAddr in
    // GetCapabilities (e.g. duplicating the Media service's XAddr instead of
    // a real events endpoint) - sending it a SOAP action it doesn't actually
    // implement there tends to abruptly close the socket rather than return
    // a clean SOAP fault. Falling back to the device's main ONVIF endpoint
    // (which handles every namespace on a single path on very cheap stacks)
    // is a pragmatic workaround other ONVIF clients use for this too.
    const deviceBaseXaddr = `http://${camera.host}:${camera.port}${camera.onvifPath || "/onvif/device_service"}`;
    const candidateXaddrs = [...new Set([eventsService.xaddr, deviceBaseXaddr])];

    let subscriptionUrl: string | null = null;
    let workingEventsService: OnvifEventsService = eventsService;
    let lastErr: unknown;
    for (const xaddr of candidateXaddrs) {
      const candidateService: OnvifEventsService = { ...eventsService, xaddr };
      try {
        subscriptionUrl = await createPullPointSubscription(candidateService);
        workingEventsService = candidateService;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!subscriptionUrl) {
      throw lastErr ?? new Error("Failed to create ONVIF PullPoint subscription");
    }

    const listener: ActiveListener = { stopped: false, subscriptionUrl, eventsService: workingEventsService };
    activeListeners.set(camera.id, listener);

    void pullLoop(camera, listener);
    logger.info({ cameraId: camera.id }, "Started ONVIF event listener (manual PullPoint over node-onvif)");
  } catch (err) {
    logger.warn({ err, cameraId: camera.id }, "Failed to start ONVIF event listener");
  }
}

export function stopEventListener(cameraId: string): void {
  const listener = activeListeners.get(cameraId);
  if (!listener) {
    return;
  }
  listener.stopped = true;
  activeListeners.delete(cameraId);
  void unsubscribe(listener.subscriptionUrl, listener.eventsService);
  logger.info({ cameraId }, "Stopped ONVIF event listener");
}

/** Stops and restarts the listener, e.g. after credentials/host changed. */
export async function restartEventListener(camera: Camera): Promise<void> {
  stopEventListener(camera.id);
  await startEventListener(camera);
}

export function isListening(cameraId: string): boolean {
  return activeListeners.has(cameraId);
}


