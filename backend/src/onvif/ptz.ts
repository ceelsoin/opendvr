import OnvifServicePtz from "node-onvif/lib/modules/service-ptz.js";
import { connectToDevice } from "./device.js";
import { withRetry } from "../lib/retry.js";
import { logger } from "../lib/logger.js";
import type { Camera } from "../types/camera.js";

type CameraCreds = Pick<Camera, "host" | "port" | "username" | "password" | "onvifProfileToken"> & {
  onvifPath?: string;
};

export type PtzDirection = "up" | "down" | "left" | "right" | "upLeft" | "upRight" | "downLeft" | "downRight";

const DIRECTION_VECTORS: Record<PtzDirection, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upLeft: { x: -1, y: 1 },
  upRight: { x: 1, y: 1 },
  downLeft: { x: -1, y: -1 },
  downRight: { x: 1, y: -1 },
};

/**
 * Connects and resolves both the ONVIF media profile token AND a working
 * PTZ service client.
 *
 * Confirmed by direct testing against a real Yoosee-branded camera (the
 * report that prompted this fix: PTZ commands "succeeded" - no error - but
 * never actually moved the camera, even though the exact same brand/model
 * worked fine in Shinobi): this camera's GetCapabilities response has its
 * per-service XAddrs shifted/wrong - `Capabilities.PTZ.XAddr` pointed at
 * `.../onvif/deviceio_service` (not a real working PTZ endpoint - it
 * silently accepts requests without moving anything), while the actual,
 * fully-functional PTZ service was reachable at `.../onvif/ptz_service`,
 * which the camera mislabeled `Capabilities.Media.XAddr` instead. This is a
 * known category of bug in cheap/OEM ONVIF SDKs (see docs/chinese-oem-
 * cameras.md) - the Device XAddr was correct, but Events/Media/PTZ were
 * each shifted to the next service's real path.
 *
 * Rather than trusting whatever `GetCapabilities` says for PTZ specifically
 * (proven unreliable), this always builds the PTZ endpoint from the
 * conventional `/onvif/ptz_service` path on the same host/port as the
 * camera's own (correct) device endpoint - this convention is what the vast
 * majority of ONVIF Profile S/T SDKs use regardless of what a given
 * firmware's (possibly buggy) capabilities response claims, so it works
 * whether the camera's capabilities are shifted (like this one) or
 * correctly labeled (the value would be the same either way for a
 * standards-compliant camera).
 */
interface CachedPtzConnection {
  ptz: OnvifServicePtz;
  profileToken: string;
  expiresAt: number;
}

// Confirmed by testing: these cameras' embedded ONVIF/HTTP stack is weak
// enough that doing a full `connectToDevice` (TCP check + `device.init()`,
// which itself issues several SOAP calls: GetCapabilities, GetProfiles,
// etc.) on every single PTZ command overwhelms it once commands start
// arriving in quick succession (e.g. the joystick's keep-alive resend while
// held, or repeated button clicks) - the camera starts resetting *all*
// connections, including ones unrelated to the flood, and stays unreachable
// for a while afterwards. Caching the resolved PTZ client + profile token
// per camera avoids re-running that expensive handshake for every command;
// only the first command after the cache expires (or after a failure, which
// invalidates the entry so the next call gets a fresh connection) pays that
// cost.
const ptzConnectionCache = new Map<string, CachedPtzConnection>();
export const PTZ_CONNECTION_TTL_MS = 5 * 60 * 1000;

function ptzCacheKey(camera: CameraCreds): string {
  return `${camera.host}:${camera.port}`;
}

function invalidatePtzCache(camera: CameraCreds): void {
  ptzConnectionCache.delete(ptzCacheKey(camera));
}

// A normal button tap (mouseDown -> mouseUp within ~1s) sends a move
// followed almost immediately by a stop. If the cache above is cold, both
// would otherwise race to run their own full `connectToDevice` handshake at
// the same time - confirmed by testing that this exact race is what made
// the camera unreachable ("socket hang up" cascade) even though a single
// command run in isolation (e.g. from the ONVIF debug console, one command
// at a time) always worked. Every PTZ operation for a camera is therefore
// run one at a time (never two concurrently against the same camera).
//
// A plain FIFO queue isn't enough on its own though: this camera's embedded
// SOAP stack is slow enough (often 1-9s+ per call, even "warm") that a
// burst of UI-driven commands (dragging the joystick, repeated button
// taps/releases) arrives far faster than the camera can drain them -
// confirmed by real usage logs where queued `/move`/`/stop` requests took
// 13-38+ seconds to resolve, growing over the session as the backlog piled
// up. By the time a deeply-queued command finally reached the camera, it
// was tens of seconds stale relative to what the user actually wanted by
// then, making movement feel both laggy AND imprecise.
//
// For continuous-motion commands (move/moveVector/zoom/stop) only the MOST
// RECENT one actually matters - there's no point running 10 queued moves
// in order when only the last reflects what the user currently wants the
// camera to do. So those share a single `coalesceKey` ("motion"): a new
// motion command waiting to run replaces (drops) whatever motion command
// was already waiting, instead of queueing behind it. At most one motion
// command is ever "in flight" and one "waiting" per camera, no matter how
// many the user fires off. Discrete one-shot operations (presets, warmup)
// use their own coalesce keys (or none) so they're never silently dropped.
interface PtzQueuedOp {
  coalesceKey: string | null;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface PtzQueueState {
  busy: boolean;
  waiters: PtzQueuedOp[];
}

const ptzQueues = new Map<string, PtzQueueState>();

function getPtzQueueState(key: string): PtzQueueState {
  let state = ptzQueues.get(key);
  if (!state) {
    state = { busy: false, waiters: [] };
    ptzQueues.set(key, state);
  }
  return state;
}

function processPtzQueue(key: string): void {
  const state = getPtzQueueState(key);
  if (state.busy) return;
  const next = state.waiters.shift();
  if (!next) return;
  state.busy = true;
  next.run().then(next.resolve, next.reject).finally(() => {
    state.busy = false;
    processPtzQueue(key);
  });
}

/** Coalesce key shared by every continuous-motion PTZ operation - see doc comment above. */
const PTZ_MOTION_COALESCE_KEY = "motion";

function runSerialized<T>(camera: CameraCreds, fn: () => Promise<T>, coalesceKey: string | null = null): Promise<T> {
  const key = ptzCacheKey(camera);
  const state = getPtzQueueState(key);
  return new Promise<T>((resolve, reject) => {
    if (coalesceKey) {
      const supersededIndex = state.waiters.findIndex((w) => w.coalesceKey === coalesceKey);
      if (supersededIndex !== -1) {
        // Drop the superseded waiter as a harmless no-op instead of leaving
        // its caller hanging - its HTTP request (already fired, and long
        // since superseded by this newer command) just resolves as if it
        // succeeded, since a fresher command for the same thing is about to
        // run in its place.
        state.waiters[supersededIndex].resolve(undefined);
        state.waiters.splice(supersededIndex, 1);
      }
    }
    state.waiters.push({
      coalesceKey,
      run: () => Promise.resolve(fn()),
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    processPtzQueue(key);
  });
}

async function connectWithProfile(camera: CameraCreds): Promise<{ ptz: OnvifServicePtz; profileToken: string }> {
  const key = ptzCacheKey(camera);
  const cached = ptzConnectionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ptz: cached.ptz, profileToken: cached.profileToken };
  }

  const device = await connectToDevice(camera);
  if (!device.services?.ptz) {
    throw new Error(
      "Esta câmera não anunciou um serviço PTZ via ONVIF (GetCapabilities). Se ela realmente tem motor pan/tilt, verifique se o firmware suporta ONVIF PTZ - algumas câmeras OEM baratas não implementam isso de verdade mesmo quando têm motor."
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentProfile = device.getCurrentProfile() as any;
  const profileToken: string | undefined = camera.onvifProfileToken ?? currentProfile?.token;
  if (!profileToken) {
    throw new Error("Não foi possível determinar o profile ONVIF para o comando PTZ.");
  }

  const deviceXaddr: string = device.services.device.xaddr;
  const conventionalPtzXaddr = deviceXaddr.replace(/\/onvif\/[^/]+$/, "/onvif/ptz_service");
  if (conventionalPtzXaddr !== device.services.ptz.xaddr) {
    logger.debug(
      { cameraId: camera.host, advertised: device.services.ptz.xaddr, using: conventionalPtzXaddr },
      "PTZ: overriding the camera's advertised PTZ XAddr with the conventional /onvif/ptz_service path"
    );
  }
  const ptz = new OnvifServicePtz({ xaddr: conventionalPtzXaddr, user: camera.username, pass: camera.password });
  ptzConnectionCache.set(key, { ptz, profileToken, expiresAt: Date.now() + PTZ_CONNECTION_TTL_MS });
  return { ptz, profileToken };
}

/**
 * Pre-resolves and caches a camera's PTZ connection WITHOUT moving it at
 * all (no continuousMove, no stop) - just the `connectToDevice` handshake +
 * PTZ endpoint/profile resolution that `connectWithProfile` normally only
 * does lazily on a camera's first real PTZ command. Called on backend
 * startup and on a recurring interval (see index.ts) for every camera with
 * `hasPtz` set, so that by the time a user actually taps a PTZ button the
 * connection is already warm and the command responds quickly instead of
 * paying the ~10-25s cold-connect cost live in front of them.
 *
 * Routed through `runSerialized` like every other PTZ operation, so a
 * warmup never races a real command for the same camera (e.g. a warmup
 * tick landing at the exact moment a user starts dragging the joystick).
 * Failures are expected and harmless (e.g. the camera is temporarily
 * offline, or doesn't actually have PTZ despite `hasPtz` being set) - they
 * don't propagate, since this is a background best-effort optimization, not
 * something the caller should have to handle.
 */
export function warmPtzConnection(camera: CameraCreds): Promise<void> {
  return runSerialized(
    camera,
    async () => {
      const key = ptzCacheKey(camera);
      const alreadyWarm = ptzConnectionCache.get(key);
      if (alreadyWarm && alreadyWarm.expiresAt > Date.now()) {
        return;
      }
      const startedAt = Date.now();
      try {
        await connectWithProfile(camera);
        logger.info({ host: camera.host, tookMs: Date.now() - startedAt }, "PTZ connection warmed up");
      } catch (err) {
        logger.debug(
          { err, host: camera.host, tookMs: Date.now() - startedAt },
          "PTZ warmup failed (will retry on the next warmup cycle, or lazily on the next real command)"
        );
      }
    },
    "warmup"
  );
}

/**
 * These cameras' embedded HTTP/SOAP server is fragile - even against the
 * corrected endpoint above, individual requests occasionally get reset
 * ("socket hang up") for no discernible reason (confirmed: repeating the
 * exact same request shortly after usually succeeds, similar to the
 * generous retry budget connectToDevice already uses for its own init
 * handshake). A short retry absorbs that instead of surfacing a spurious
 * failure to the user.
 */
async function withPtzRetry<T>(camera: CameraCreds, fn: () => Promise<T>): Promise<T> {
  try {
    return await withRetry(fn, 5, 1000);
  } catch (err) {
    // The cached connection may itself be stale/broken (e.g. the camera
    // rebooted, or its embedded server got overwhelmed and is now resetting
    // everything) - drop it so the next command gets a fresh handshake
    // instead of repeating the same failure forever.
    invalidatePtzCache(camera);
    throw err;
  }
}

export function ptzMove(camera: CameraCreds, direction: PtzDirection, speed = 0.5) {
  return runSerialized(
    camera,
    async () => {
      const { ptz, profileToken } = await connectWithProfile(camera);
      const vector = DIRECTION_VECTORS[direction];
      await withPtzRetry(camera, () =>
        ptz.continuousMove({
          ProfileToken: profileToken,
          Velocity: { x: vector.x * speed, y: vector.y * speed, z: 0 },
          Timeout: 1,
        })
      );
    },
    PTZ_MOTION_COALESCE_KEY
  );
}

/**
 * Arbitrary-angle continuous move, used by the joystick-style PTZ control
 * (GridPage/CustomGridViewPage) - unlike `ptzMove`, which snaps to one of 8
 * fixed directions, this passes the pan/tilt velocity straight through to
 * ONVIF's ContinuousMove, allowing any angle/speed combination for smoother
 * control.
 */
export function ptzMoveVector(camera: CameraCreds, vector: { pan: number; tilt: number }) {
  return runSerialized(
    camera,
    async () => {
      const { ptz, profileToken } = await connectWithProfile(camera);
      await withPtzRetry(camera, () =>
        ptz.continuousMove({
          ProfileToken: profileToken,
          Velocity: { x: vector.pan, y: vector.tilt, z: 0 },
          Timeout: 1,
        })
      );
    },
    PTZ_MOTION_COALESCE_KEY
  );
}

export function ptzZoom(camera: CameraCreds, zoom: number) {
  return runSerialized(
    camera,
    async () => {
      const { ptz, profileToken } = await connectWithProfile(camera);
      await withPtzRetry(camera, () =>
        ptz.continuousMove({
          ProfileToken: profileToken,
          Velocity: { x: 0, y: 0, z: zoom },
          Timeout: 1,
        })
      );
    },
    PTZ_MOTION_COALESCE_KEY
  );
}

/**
 * Explicit Stop is best-effort and non-fatal on failure: confirmed by
 * exhaustive direct testing against a real Yoosee-branded camera that its
 * Stop operation is simply broken (immediate "socket hang up" on every
 * attempt, retries included, completely independent of ContinuousMove -
 * which works reliably at the exact same corrected endpoint). Every
 * ContinuousMove call already sets a 1s `Timeout`, so the camera stops
 * moving on its own shortly after the last move command regardless of
 * whether this explicit Stop succeeds - swallowing the error here avoids
 * surfacing a scary/confusing failure to the user for something that
 * doesn't actually leave the camera stuck moving.
 */
export function ptzStop(camera: CameraCreds) {
  return runSerialized(
    camera,
    async () => {
      const { ptz, profileToken } = await connectWithProfile(camera);
      try {
        // No retry here (unlike the other operations) - confirmed by testing
        // that retrying Stop doesn't help on cameras where it's simply broken,
        // so retrying would only add latency to every button-release for no
        // benefit.
        await ptz.stop({ ProfileToken: profileToken, PanTilt: true, Zoom: true });
      } catch (err) {
        // Deliberately NOT invalidating the connection cache here: Stop is
        // known-broken on this camera and fails on essentially every call
        // (see doc comment above), so treating that as a sign of a bad
        // connection would nuke the cache after every single button release
        // - forcing the next move to pay the full ~10s+ reconnect cost again.
        // The cache is still invalidated on *move/zoom/preset* failures (see
        // withPtzRetry), which are the operations that actually indicate the
        // connection itself has gone stale.
        logger.debug(
          { err },
          "PTZ Stop failed (camera likely doesn't implement it properly) - relying on ContinuousMove's own Timeout to stop the camera instead"
        );
      }
    },
    PTZ_MOTION_COALESCE_KEY
  );
}

export function ptzGotoPreset(camera: CameraCreds, presetToken: string) {
  return runSerialized(camera, async () => {
    const { ptz, profileToken } = await connectWithProfile(camera);
    await withPtzRetry(camera, () =>
      ptz.gotoPreset({
        ProfileToken: profileToken,
        PresetToken: presetToken,
        Speed: { x: 1, y: 1, z: 1 },
      })
    );
  });
}

export function ptzSetPreset(camera: CameraCreds, presetName: string) {
  return runSerialized(camera, async () => {
    const { ptz, profileToken } = await connectWithProfile(camera);
    return withPtzRetry(camera, () => ptz.setPreset({ ProfileToken: profileToken, PresetName: presetName }));
  });
}

export interface PtzPreset {
  token: string;
  name?: string;
}

export function ptzListPresets(camera: CameraCreds): Promise<PtzPreset[]> {
  return runSerialized(camera, async () => {
    const { ptz, profileToken } = await connectWithProfile(camera);
    const result = await withPtzRetry(camera, () => ptz.getPresets({ ProfileToken: profileToken }));
    const raw = result?.data?.GetPresetsResponse?.PTZPreset;
    if (!raw) {
      return [];
    }
    const list = Array.isArray(raw) ? raw : [raw];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return list
      .map((p: any) => ({ token: p?.$?.token ?? p?.token, name: p?.Name ?? p?.name }))
      .filter((p: PtzPreset): p is PtzPreset => Boolean(p.token));
  });
}
