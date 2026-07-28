import { connectToDevice } from "./device.js";
import type { Camera } from "../types/camera.js";

type CameraCreds = Pick<Camera, "id" | "host" | "port" | "username" | "password" | "onvifProfileToken"> & {
  onvifPath?: string;
};

/**
 * Resolves the snapshot (JPEG) URI for a camera's main profile via ONVIF
 * GetSnapshotUri, then fetches the actual image bytes. Best-effort: returns
 * null (never throws) if the camera doesn't support snapshots, the profile
 * token can't be resolved, or the HTTP fetch fails/needs an auth scheme we
 * don't support (only plain HTTP Basic is attempted here - some cameras
 * require Digest, which would need a full challenge/response round-trip).
 */
export async function captureSnapshot(camera: CameraCreds): Promise<Buffer | null> {
  try {
    const device = await connectToDevice(camera);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiles = (device.getProfileList() as any[]) ?? [];
    const profileToken = camera.onvifProfileToken ?? profiles[0]?.token;
    if (!profileToken) {
      return null;
    }

    const result = await device.services.media.getSnapshotUri({ ProfileToken: profileToken });
    const snapshotUri: string | undefined = result?.data?.GetSnapshotUriResponse?.MediaUri?.Uri;
    if (!snapshotUri) {
      return null;
    }

    const basicAuth = Buffer.from(`${camera.username}:${camera.password}`).toString("base64");
    const res = await fetch(snapshotUri, { headers: { Authorization: `Basic ${basicAuth}` } });
    if (!res.ok) {
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
