import { connectToDevice } from "./device.js";
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
 * Connects and resolves the ONVIF media profile token PTZ commands need.
 * Also guards against cameras that don't actually expose a PTZ service -
 * `node-onvif` only populates `device.services.ptz` if `GetCapabilities`
 * advertised one, so calling `.continuousMove()`/etc on it directly would
 * otherwise throw an opaque "Cannot read properties of undefined" instead
 * of a clear message (this is common on fixed/non-motorized cameras that
 * got flagged `hasPtz: true` by mistake, or whose ONVIF stack lies about
 * capabilities the way it already does for Events on some cheap OEM
 * cameras - see docs/chinese-oem-cameras.md).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connectWithProfile(camera: CameraCreds): Promise<{ device: any; profileToken: string }> {
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
  return { device, profileToken };
}

export async function ptzMove(camera: CameraCreds, direction: PtzDirection, speed = 0.5) {
  const { device, profileToken } = await connectWithProfile(camera);
  const vector = DIRECTION_VECTORS[direction];
  await device.services.ptz.continuousMove({
    ProfileToken: profileToken,
    Velocity: { x: vector.x * speed, y: vector.y * speed, z: 0 },
    Timeout: 1,
  });
}

/**
 * Arbitrary-angle continuous move, used by the joystick-style PTZ control
 * (GridPage/CustomGridViewPage) - unlike `ptzMove`, which snaps to one of 8
 * fixed directions, this passes the pan/tilt velocity straight through to
 * ONVIF's ContinuousMove, allowing any angle/speed combination for smoother
 * control.
 */
export async function ptzMoveVector(camera: CameraCreds, vector: { pan: number; tilt: number }) {
  const { device, profileToken } = await connectWithProfile(camera);
  await device.services.ptz.continuousMove({
    ProfileToken: profileToken,
    Velocity: { x: vector.pan, y: vector.tilt, z: 0 },
    Timeout: 1,
  });
}

export async function ptzZoom(camera: CameraCreds, zoom: number) {
  const { device, profileToken } = await connectWithProfile(camera);
  await device.services.ptz.continuousMove({
    ProfileToken: profileToken,
    Velocity: { x: 0, y: 0, z: zoom },
    Timeout: 1,
  });
}

export async function ptzStop(camera: CameraCreds) {
  const { device, profileToken } = await connectWithProfile(camera);
  await device.services.ptz.stop({ ProfileToken: profileToken, PanTilt: true, Zoom: true });
}

export async function ptzGotoPreset(camera: CameraCreds, presetToken: string) {
  const { device, profileToken } = await connectWithProfile(camera);
  await device.services.ptz.gotoPreset({
    ProfileToken: profileToken,
    PresetToken: presetToken,
    Speed: { x: 1, y: 1, z: 1 },
  });
}

export async function ptzSetPreset(camera: CameraCreds, presetName: string) {
  const { device, profileToken } = await connectWithProfile(camera);
  return device.services.ptz.setPreset({ ProfileToken: profileToken, PresetName: presetName });
}

export interface PtzPreset {
  token: string;
  name?: string;
}

export async function ptzListPresets(camera: CameraCreds): Promise<PtzPreset[]> {
  const { device, profileToken } = await connectWithProfile(camera);
  const result = await device.services.ptz.getPresets({ ProfileToken: profileToken });
  const raw = result?.data?.GetPresetsResponse?.PTZPreset;
  if (!raw) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return list
    .map((p: any) => ({ token: p?.$?.token ?? p?.token, name: p?.Name ?? p?.name }))
    .filter((p: PtzPreset): p is PtzPreset => Boolean(p.token));
}
