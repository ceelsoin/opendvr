import nodeOnvif from "node-onvif";
import type { Camera } from "../types/camera.js";
import { isTcpPortReachable } from "../lib/tcpCheck.js";
import { withRetry } from "../lib/retry.js";

type CameraCreds = Pick<Camera, "host" | "port" | "username" | "password"> & {
  onvifPath?: string;
};

function buildXaddr(camera: CameraCreds): string {
  const path = camera.onvifPath || "/onvif/device_service";
  return `http://${camera.host}:${camera.port}${path}`;
}

/**
 * Connects to a camera's ONVIF service using stored credentials.
 * Throws if the camera is unreachable or credentials are invalid.
 *
 * Uses `node-onvif` rather than the `onvif` package: the latter always opens
 * its connection with an unauthenticated `GetSystemDateAndTime` call, which
 * several cheap/OEM cameras (e.g. Yoosee-based models) reset the connection
 * on instead of responding - confirmed empirically against a real device
 * (see scripts/test-onvif-isolated.js and /memories/repo notes). `node-onvif`
 * (the library Shinobi's ONVIF fork is based on) connects to the same
 * cameras without issues.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function connectToDevice(camera: CameraCreds): Promise<any> {
  // Generous timeout/retry budget so cameras with high latency (slow
  // embedded stacks, congested Wi-Fi, etc.) get every chance to respond
  // instead of being treated as unreachable prematurely.
  const reachable = await isTcpPortReachable(camera.host, camera.port, 15_000);
  if (!reachable) {
    throw new Error(
      `Não foi possível abrir uma conexão TCP com ${camera.host}:${camera.port}. Verifique rede/firewall/porta.`
    );
  }

  const device = new nodeOnvif.OnvifDevice({
    xaddr: buildXaddr(camera),
    user: camera.username,
    pass: camera.password,
  });

  await withRetry(() => device.init(), 5, 2000);
  return device;
}

export interface DiscoveredStream {
  profileToken: string;
  name: string;
  encoding: string | null;
  width: number | null;
  height: number | null;
  rtspUri: string;
}

/**
 * Connects via ONVIF and lists every media profile's RTSP stream URI (main,
 * sub, etc.), similar to Agent DVR/iSpy's "Obter URLs de vídeo" feature.
 * node-onvif resolves these as part of the profile list itself, with no
 * separate GetStreamUri round-trip needed per profile.
 */
export async function discoverStreams(camera: CameraCreds): Promise<DiscoveredStream[]> {
  const device = await connectToDevice(camera);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profiles = (device.getProfileList() as any[]) ?? [];

  return profiles
    .filter((p) => p?.stream?.rtsp)
    .map((p) => ({
      profileToken: p.token,
      name: p.name || p.token,
      encoding: p.video?.encoder?.encoding ?? null,
      width: p.video?.encoder?.resolution?.width ?? null,
      height: p.video?.encoder?.resolution?.height ?? null,
      rtspUri: p.stream.rtsp as string,
    }));
}
